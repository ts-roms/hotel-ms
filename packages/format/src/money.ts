const DEFAULT_LOCALE = 'en-PH';

/** Minor-unit digits of an ISO 4217 currency (PHP 2, JPY 0, KWD 3), from ICU. */
export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** Formats minor units (e.g. centavos) in the currency's own number of decimals. */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amountMinor / 10 ** currencyDigits(currency),
  );
}

/** Parses a user-entered amount ("3,500.50") into minor units; null if invalid. */
export function parseMoney(input: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const clean = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  if (fraction.length > digits) return null;
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || 0);
}

/** Minor units as a plain decimal string for an input field ("350000" PHP → "3500.00"). */
export function minorToInput(amountMinor: number, currency: string): string {
  const digits = currencyDigits(currency);
  return (amountMinor / 10 ** digits).toFixed(digits);
}
