import { describe, expect, it } from 'vitest';
import { type AttendanceRulesInput, computeAttendanceDays } from './attendance-rules.js';

const TZ = 'Asia/Manila';
const at = (local: string) => new Date(`${local}:00+08:00`);
const E = { id: '00000000-0000-7000-8000-000000000001', name: 'Ana' };

function run(partial: Partial<AttendanceRulesInput>) {
  return computeAttendanceDays({
    timeZone: TZ,
    now: at('2026-10-10T12:00'),
    employees: [E],
    shifts: [],
    punches: [],
    leaveDays: new Set(),
    from: '2026-10-01',
    to: '2026-10-09',
    ...partial,
  });
}

const dayShift = {
  employeeId: E.id,
  date: '2026-10-05',
  startsAt: at('2026-10-05T06:00'),
  endsAt: at('2026-10-05T14:00'),
  breakMinutes: 60,
};

describe('attendance rules', () => {
  it('on time, with a break: worked = time on the clock minus breaks', () => {
    const [day] = run({
      shifts: [dayShift],
      punches: [
        { employeeId: E.id, type: 'IN', at: at('2026-10-05T05:55') },
        { employeeId: E.id, type: 'BREAK_START', at: at('2026-10-05T10:00') },
        { employeeId: E.id, type: 'BREAK_END', at: at('2026-10-05T11:00') },
        { employeeId: E.id, type: 'OUT', at: at('2026-10-05T14:02') },
      ],
    });
    expect(day).toMatchObject({
      date: '2026-10-05',
      status: 'PRESENT',
      workedMinutes: 7 * 60 + 7,
      breakMinutes: 60,
      lateMinutes: 0,
      undertimeMinutes: 0,
      overtimeMinutes: 7,
    });
  });

  it('late beyond the grace period and leaving early', () => {
    const [day] = run({
      shifts: [dayShift],
      punches: [
        { employeeId: E.id, type: 'IN', at: at('2026-10-05T06:20') },
        { employeeId: E.id, type: 'OUT', at: at('2026-10-05T13:30') },
      ],
    });
    expect(day).toMatchObject({ lateMinutes: 20, undertimeMinutes: 30, overtimeMinutes: 10 });
    // Within the grace period is not late.
    const [onTime] = run({
      shifts: [dayShift],
      punches: [
        { employeeId: E.id, type: 'IN', at: at('2026-10-05T06:04') },
        { employeeId: E.id, type: 'OUT', at: at('2026-10-05T14:00') },
      ],
    });
    expect(onTime!.lateMinutes).toBe(0);
  });

  it('a night shift belongs to the day it starts, across midnight', () => {
    const days = run({
      shifts: [
        {
          employeeId: E.id,
          date: '2026-10-05',
          startsAt: at('2026-10-05T22:00'),
          endsAt: at('2026-10-06T06:00'),
          breakMinutes: 60,
        },
      ],
      punches: [
        { employeeId: E.id, type: 'IN', at: at('2026-10-05T21:58') },
        { employeeId: E.id, type: 'OUT', at: at('2026-10-06T06:01') },
      ],
    });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: '2026-10-05', workedMinutes: 483, status: 'PRESENT' });
  });

  it('absent, scheduled, on leave, incomplete and unscheduled work', () => {
    const days = run({
      now: at('2026-10-07T12:00'),
      shifts: [
        dayShift,
        {
          ...dayShift,
          date: '2026-10-08',
          startsAt: at('2026-10-08T06:00'),
          endsAt: at('2026-10-08T14:00'),
        },
      ],
      punches: [
        { employeeId: E.id, type: 'IN', at: at('2026-10-02T09:00') },
        { employeeId: E.id, type: 'IN', at: at('2026-10-03T09:00') },
        { employeeId: E.id, type: 'OUT', at: at('2026-10-03T12:00') },
      ],
      leaveDays: new Set([`${E.id}:2026-10-06`]),
    });
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
    expect(byDate['2026-10-02']!.status).toBe('INCOMPLETE');
    // Unscheduled work counts entirely as overtime.
    expect(byDate['2026-10-03']).toMatchObject({
      status: 'PRESENT',
      workedMinutes: 180,
      overtimeMinutes: 180,
    });
    expect(byDate['2026-10-05']!.status).toBe('ABSENT');
    expect(byDate['2026-10-06']!.status).toBe('ON_LEAVE');
    expect(byDate['2026-10-08']!.status).toBe('SCHEDULED');
  });

  it('someone still on the clock is present, not incomplete', () => {
    const [day] = run({
      now: at('2026-10-05T09:00'),
      shifts: [dayShift],
      punches: [{ employeeId: E.id, type: 'IN', at: at('2026-10-05T06:00') }],
    });
    expect(day).toMatchObject({ status: 'PRESENT', workedMinutes: 0, overtimeMinutes: 0 });
  });
});
