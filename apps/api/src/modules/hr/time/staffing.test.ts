import { describe, expect, it } from 'vitest';
import { weekdayOf } from '../../../common/dates.js';
import { minimumOnShift } from './coverage.js';

const at = (hhmm: string, day = 2) => new Date(`2026-11-0${day}T${hhmm}:00Z`);
const shift = (employeeId: string, from: string, to: string, toDay = 2) => ({
  employeeId,
  startsAt: at(from),
  endsAt: at(to, toDay),
});

describe('minimumOnShift', () => {
  it('counts a handover as continuous cover', () => {
    const shifts = [shift('a', '06:00', '14:00'), shift('b', '14:00', '22:00')];
    expect(minimumOnShift(shifts, at('06:00'), at('22:00'))).toBe(1);
  });

  it('finds the thinnest moment of the window', () => {
    const shifts = [
      shift('a', '06:00', '14:00'),
      shift('b', '08:00', '17:00'),
      shift('c', '14:00', '22:00'),
    ];
    // 06–08: a; 08–14: a, b; 14–17: b, c; 17–22: c.
    expect(minimumOnShift(shifts, at('08:00'), at('17:00'))).toBe(2);
    expect(minimumOnShift(shifts, at('06:00'), at('22:00'))).toBe(1);
  });

  it('is zero when a gap opens anywhere in the window', () => {
    const shifts = [shift('a', '06:00', '12:00'), shift('b', '13:00', '22:00')];
    expect(minimumOnShift(shifts, at('06:00'), at('22:00'))).toBe(0);
    expect(minimumOnShift([], at('06:00'), at('22:00'))).toBe(0);
  });

  it('counts a person once, and handles windows past midnight', () => {
    const night = [shift('a', '22:00', '06:00', 3), shift('b', '22:00', '06:00', 3)];
    expect(minimumOnShift(night, at('23:00'), at('05:00', 3))).toBe(2);
    expect(
      minimumOnShift(
        [shift('a', '06:00', '14:00'), shift('a', '14:00', '22:00')],
        at('06:00'),
        at('22:00'),
      ),
    ).toBe(1);
  });
});

describe('weekdayOf', () => {
  it('numbers Sunday 0 to Saturday 6', () => {
    expect(weekdayOf('2026-11-01')).toBe(0);
    expect(weekdayOf('2026-11-07')).toBe(6);
  });
});
