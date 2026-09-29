import { describe, expect, it } from 'vitest';
import {
  addDays,
  currencyDigits,
  elapsed,
  formatDate,
  formatMoney,
  formatTime,
  fromZoned,
  localDate,
  minorToInput,
  parseMoney,
  toZoned,
} from './index.js';

const digitsOnly = (s: string) => s.replace(/[^\d.,]/g, '');

describe('money', () => {
  it('scales by the currency, not a fixed /100', () => {
    expect(currencyDigits('JPY')).toBe(0);
    expect(digitsOnly(formatMoney(123_450, 'PHP'))).toBe('1,234.50');
    expect(digitsOnly(formatMoney(1_500, 'JPY'))).toBe('1,500');
    expect(digitsOnly(formatMoney(1_500, 'KWD'))).toBe('1.500');
  });

  it('parses input into minor units and back', () => {
    expect(parseMoney('3,500.50', 'PHP')).toBe(350_050);
    expect(parseMoney('3500', 'JPY')).toBe(3_500);
    expect(parseMoney('1.234', 'PHP')).toBeNull();
    expect(parseMoney('abc', 'PHP')).toBeNull();
    expect(minorToInput(350_000, 'PHP')).toBe('3500.00');
    expect(minorToInput(3_500, 'JPY')).toBe('3500');
  });
});

describe('dates', () => {
  it('formats and shifts calendar dates without time zone drift', () => {
    expect(formatDate('2026-10-05')).toBe('Mon, Oct 5');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('takes the calendar date of an instant in a time zone', () => {
    // 2026-10-05 17:30 UTC is already Oct 6 in Manila (UTC+8).
    expect(localDate('2026-10-05T17:30:00Z', 'Asia/Manila')).toBe('2026-10-06');
    expect(localDate('2026-10-05T17:30:00Z', 'UTC')).toBe('2026-10-05');
  });
});

describe('formatTime', () => {
  const iso = '2026-10-05T06:03:09Z'; // 14:03:09 in Manila
  it('shows the time of day in a time zone', () => {
    expect(formatTime(iso, { timeZone: 'Asia/Manila', hour12: false })).toBe('14:03');
    expect(formatTime(iso, { timeZone: 'Asia/Manila', hour12: false, seconds: true })).toBe(
      '14:03:09',
    );
    expect(formatTime(iso, { timeZone: 'UTC', hour12: false })).toBe('06:03');
  });
  it('uses a 12-hour clock by default in en-PH', () => {
    expect(formatTime(iso, { timeZone: 'Asia/Manila' }).replace(/s/g, ' ')).toMatch(/^2:03 PM$/i);
  });
});

describe('zoned', () => {
  it('round-trips property wall-clock time', () => {
    expect(toZoned('2026-10-05T06:00:00Z', 'Asia/Manila')).toEqual({
      date: '2026-10-05',
      time: '14:00',
    });
    expect(fromZoned('2026-10-05', '14:00', 'Asia/Manila')).toBe('2026-10-05T06:00:00.000Z');
    // Across a DST change: 2026-03-08 03:30 New York is EDT (UTC-4).
    expect(fromZoned('2026-03-08', '03:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
  });
});

describe('elapsed', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  it('buckets into now, minutes, hours and older', () => {
    expect(elapsed('2026-10-05T11:59:50Z', now)).toEqual({ unit: 'now' });
    expect(elapsed('2026-10-05T11:55:00Z', now)).toEqual({ unit: 'minutes', value: 5 });
    expect(elapsed('2026-10-05T09:00:00Z', now)).toEqual({ unit: 'hours', value: 3 });
    expect(elapsed('2026-10-04T09:00:00Z', now)).toEqual({ unit: 'days' });
  });
});
