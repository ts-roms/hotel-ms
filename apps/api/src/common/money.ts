/**
 * The API's money helpers work on bigint minor units and micro-unit exchange rates, as the
 * database stores them. Currency digits and display formatting come from @hotel/format.
 */
import { currencyDigits, formatMoney } from '@hotel/format';

/** 123_450n PHP → "₱1,234.50"; scales by the currency's own minor units (JPY 0, KWD 3). */
export function formatMinor(minor: bigint, currency: string, locale = 'en-PH'): string {
  return formatMoney(Number(minor), currency, locale);
}

/** Minor units as a major-unit number in the currency's own decimals (JSON exports). */
export function toMajor(minor: bigint | number, currency: string): number {
  return Number(minor) / 10 ** currencyDigits(currency);
}

/** Minor units as a plain decimal string, e.g. "1234.50" PHP or "1500" JPY (CSV exports). */
export function toDecimalString(minor: bigint | number, currency: string): string {
  return toMajor(minor, currency).toFixed(currencyDigits(currency));
}

const MICROS = 1_000_000n;

/** "56.25" → 56_250_000n (exact; up to 6 decimals). */
export function parseRateMicros(rate: string): bigint {
  const [whole = '0', fraction = ''] = rate.split('.');
  return BigInt(whole) * MICROS + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}

/** 56_250_000n → "56.25" */
export function formatRate(micros: bigint): string {
  const whole = micros / MICROS;
  const fraction = (micros % MICROS).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/**
 * Converts foreign cash to the property currency, in minor units, rounding half up:
 * amount × rate, scaled between the two currencies' minor units.
 */
export function convertMinor(
  amountMinor: bigint,
  fromCurrency: string,
  rateMicros: bigint,
  toCurrency: string,
): bigint {
  const numerator = amountMinor * rateMicros * 10n ** BigInt(currencyDigits(toCurrency));
  const denominator = MICROS * 10n ** BigInt(currencyDigits(fromCurrency));
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Minor units as a JSON-safe number (contracts use integers; bigint stays in the DB layer). */
export function toMinor(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Amount exceeds safe integer range');
  return n;
}
