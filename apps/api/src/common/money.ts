/** Minor-unit digits of an ISO 4217 currency (PHP 2, JPY 0, KWD 3), from ICU. */
export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
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
