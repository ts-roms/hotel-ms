import { describe, expect, it } from 'vitest';
import { fromLocal, localToday, toLocal } from './zoned.js';

describe('zoned time', () => {
  it('converts Manila wall-clock times (UTC+8, no DST)', () => {
    expect(fromLocal('2026-10-05', '06:00', 'Asia/Manila').toISOString()).toBe(
      '2026-10-04T22:00:00.000Z',
    );
    expect(toLocal(new Date('2026-10-04T22:00:00Z'), 'Asia/Manila')).toEqual({
      date: '2026-10-05',
      time: '06:00',
    });
  });

  it('round-trips across a DST change (New York, spring forward and fall back)', () => {
    // 2026-03-08: clocks jump 02:00 → 03:00 (UTC-5 → UTC-4).
    expect(fromLocal('2026-03-08', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T06:30:00.000Z',
    );
    expect(fromLocal('2026-03-08', '06:00', 'America/New_York').toISOString()).toBe(
      '2026-03-08T10:00:00.000Z',
    );
    // A night shift 22:00 → 06:00 over the change is 7 hours long, not 8.
    const start = fromLocal('2026-03-07', '22:00', 'America/New_York');
    const end = fromLocal('2026-03-08', '06:00', 'America/New_York');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(7);
    // 2026-11-01: 02:00 → 01:00 (UTC-4 → UTC-5); the ambiguous 01:30 resolves once.
    const ambiguous = fromLocal('2026-11-01', '01:30', 'America/New_York');
    expect(toLocal(ambiguous, 'America/New_York')).toEqual({ date: '2026-11-01', time: '01:30' });
  });

  it('knows the local date around midnight', () => {
    const instant = new Date('2026-10-04T16:30:00Z'); // 00:30 on the 5th in Manila
    expect(localToday('Asia/Manila', instant)).toBe('2026-10-05');
    expect(localToday('UTC', instant)).toBe('2026-10-04');
    // Without a zone: the runtime's own (what the device shows).
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(localToday(undefined, instant)).toBe(toLocal(instant, own).date);
  });
});
