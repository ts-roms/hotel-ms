import { describe, expect, it } from 'vitest';
import {
  convertMinor,
  formatMinor,
  formatRate,
  parseRateMicros,
  toDecimalString,
  toMajor,
} from './money.js';

describe('money', () => {
  it('parses and formats exchange rates exactly', () => {
    expect(parseRateMicros('56.25')).toBe(56_250_000n);
    expect(parseRateMicros('0.382')).toBe(382_000n);
    expect(parseRateMicros('58')).toBe(58_000_000n);
    expect(formatRate(56_250_000n)).toBe('56.25');
    expect(formatRate(58_000_000n)).toBe('58');
    expect(formatRate(382_123n)).toBe('0.382123');
  });

  it('converts between currencies with different minor units, rounding half up', () => {
    // USD 100.00 at 56.25 = PHP 5,625.00
    expect(convertMinor(10_000n, 'USD', 56_250_000n, 'PHP')).toBe(562_500n);
    // JPY 10,000 at 0.382 = PHP 3,820.00
    expect(convertMinor(10_000n, 'JPY', 382_000n, 'PHP')).toBe(382_000n);
    // USD 0.01 at 56.255 = PHP 0.56255 → 0.56
    expect(convertMinor(1n, 'USD', 56_255_000n, 'PHP')).toBe(56n);
    // USD 0.01 at 56.25 = 0.5625 → 0.56; at 56.5 = 0.565 → 0.57 (half up)
    expect(convertMinor(1n, 'USD', 56_500_000n, 'PHP')).toBe(57n);
  });

  it('formats minor units by the currency, not a fixed /100', () => {
    const plain = (s: string) => s.replace(/[^\d.,]/g, '');
    expect(plain(formatMinor(123_450n, 'PHP'))).toBe('1,234.50');
    expect(plain(formatMinor(1_500n, 'JPY'))).toBe('1,500');
    expect(plain(formatMinor(1_500n, 'KWD'))).toBe('1.500');
  });

  it('converts minor units to major units by the currency (exports)', () => {
    expect(toMajor(123_450n, 'PHP')).toBe(1234.5);
    expect(toMajor(1_500, 'JPY')).toBe(1500);
    expect(toDecimalString(123_450n, 'PHP')).toBe('1234.50');
    expect(toDecimalString(1_500, 'JPY')).toBe('1500');
    expect(toDecimalString(1_500n, 'KWD')).toBe('1.500');
  });
});
