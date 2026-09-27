import type { AttendanceDay, PunchType } from '@hotel/contracts';
import { toLocal } from '../../common/zoned-time.js';

export interface RulesShift {
  employeeId: string;
  date: string;
  startsAt: Date;
  endsAt: Date;
  breakMinutes: number;
}

export interface RulesPunch {
  employeeId: string;
  type: PunchType;
  at: Date;
}

export interface AttendanceRulesInput {
  timeZone: string;
  now: Date;
  /** Punches up to this long before a shift's start count toward that shift. */
  earlyWindowMinutes?: number;
  /** Arriving up to this late is not counted as late. */
  graceMinutes?: number;
  employees: { id: string; name: string }[];
  /** Published shifts only. */
  shifts: RulesShift[];
  /** Effective punches, originals and approved corrections. Any order. */
  punches: RulesPunch[];
  /** `${employeeId}:${date}` for days of approved leave. */
  leaveDays: ReadonlySet<string>;
  from: string;
  to: string;
}

interface Session {
  start: Date;
  end: Date | null;
  breakMs: number;
}

const minutes = (ms: number) => Math.max(0, Math.floor(ms / 60_000));

/** IN … [BREAK_START … BREAK_END]* … OUT. Out-of-order punches start a new session. */
export function toSessions(punches: RulesPunch[]): Session[] {
  const sessions: Session[] = [];
  let current: Session | null = null;
  let breakStart: Date | null = null;
  for (const p of [...punches].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (p.type === 'IN') {
      if (current) sessions.push(current); // IN without OUT: left open (incomplete)
      current = { start: p.at, end: null, breakMs: 0 };
      breakStart = null;
    } else if (!current) {
      continue; // OUT or break without IN: ignored; the day shows as incomplete elsewhere
    } else if (p.type === 'BREAK_START') {
      breakStart = p.at;
    } else if (p.type === 'BREAK_END') {
      if (breakStart) current.breakMs += p.at.getTime() - breakStart.getTime();
      breakStart = null;
    } else {
      if (breakStart) current.breakMs += p.at.getTime() - breakStart.getTime();
      current.end = p.at;
      sessions.push(current);
      current = null;
      breakStart = null;
    }
  }
  if (current) sessions.push(current);
  return sessions;
}

/**
 * Daily attendance per employee (blueprint §13.2): punches are matched to the shift they
 * fall in, days are property-local, and lateness, undertime and overtime are derived from
 * the published schedule. Pure: the same inputs always give the same days.
 */
export function computeAttendanceDays(input: AttendanceRulesInput): AttendanceDay[] {
  const earlyMs = (input.earlyWindowMinutes ?? 240) * 60_000;
  const graceMinutes = input.graceMinutes ?? 5;
  const days: AttendanceDay[] = [];

  for (const employee of input.employees) {
    const shifts = input.shifts
      .filter((s) => s.employeeId === employee.id)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const sessions = toSessions(input.punches.filter((p) => p.employeeId === employee.id));

    const byDate = new Map<string, { shift: RulesShift | null; sessions: Session[] }>();
    const slot = (date: string) => {
      let entry = byDate.get(date);
      if (!entry) {
        entry = { shift: null, sessions: [] };
        byDate.set(date, entry);
      }
      return entry;
    };
    for (const shift of shifts) {
      const entry = slot(shift.date);
      entry.shift ??= shift;
    }
    for (const session of sessions) {
      const t = session.start.getTime();
      const shift = shifts.find(
        (s) => t >= s.startsAt.getTime() - earlyMs && t < s.endsAt.getTime(),
      );
      slot(shift ? shift.date : toLocal(session.start, input.timeZone).date).sessions.push(session);
    }
    for (let d = new Date(`${input.from}T00:00:00Z`); ; d = new Date(d.getTime() + 86_400_000)) {
      const date = d.toISOString().slice(0, 10);
      if (date > input.to) break;
      if (input.leaveDays.has(`${employee.id}:${date}`)) slot(date);
    }

    for (const [date, { shift, sessions: daySessions }] of [...byDate].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (date < input.from || date > input.to) continue;
      const onLeave = input.leaveDays.has(`${employee.id}:${date}`);
      const complete = daySessions.filter((s) => s.end !== null);
      const open = daySessions.filter((s) => s.end === null);
      const workedMs = complete.reduce(
        (sum, s) => sum + (s.end!.getTime() - s.start.getTime() - s.breakMs),
        0,
      );
      const breakMs = daySessions.reduce((sum, s) => sum + s.breakMs, 0);
      const firstIn = daySessions.length
        ? new Date(Math.min(...daySessions.map((s) => s.start.getTime())))
        : null;
      const lastOut = complete.length
        ? new Date(Math.max(...complete.map((s) => s.end!.getTime())))
        : null;
      const scheduledMinutes = shift
        ? minutes(shift.endsAt.getTime() - shift.startsAt.getTime()) - shift.breakMinutes
        : 0;

      let status: AttendanceDay['status'];
      if (daySessions.length === 0) {
        status = onLeave
          ? 'ON_LEAVE'
          : shift && shift.endsAt.getTime() <= input.now.getTime()
            ? 'ABSENT'
            : 'SCHEDULED';
      } else if (open.length > 0) {
        // Still on the clock, or forgot to clock out (needs a correction).
        const ongoing =
          open.length === 1 &&
          open[0] === daySessions.at(-1) &&
          input.now.getTime() - open[0]!.start.getTime() < 18 * 3_600_000;
        status = ongoing ? 'PRESENT' : 'INCOMPLETE';
      } else {
        status = 'PRESENT';
      }

      const lateRaw = shift && firstIn ? minutes(firstIn.getTime() - shift.startsAt.getTime()) : 0;
      const workedMinutes = minutes(workedMs);
      const finished = open.length === 0 && complete.length > 0;
      days.push({
        employeeId: employee.id,
        employeeName: employee.name,
        date,
        status,
        shift: shift
          ? {
              startsAt: shift.startsAt.toISOString(),
              endsAt: shift.endsAt.toISOString(),
              breakMinutes: shift.breakMinutes,
            }
          : null,
        firstIn: firstIn?.toISOString() ?? null,
        lastOut: lastOut?.toISOString() ?? null,
        workedMinutes,
        breakMinutes: minutes(breakMs),
        lateMinutes: lateRaw > graceMinutes ? lateRaw : 0,
        undertimeMinutes:
          shift && finished && lastOut ? minutes(shift.endsAt.getTime() - lastOut.getTime()) : 0,
        overtimeMinutes: finished ? Math.max(0, workedMinutes - scheduledMinutes) : 0,
      });
    }
  }
  return days;
}
