/** Formats minor units (e.g. centavos) in the currency's own number of decimals. */
export function formatMoney(amountMinor: number, currency: string, locale = 'en-PH'): string {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** digits);
}

/** Parses a user-entered amount ("3,500.50") into minor units; null if invalid. */
export function parseMoney(input: string, currency: string, locale = 'en-PH'): number | null {
  const digits =
    new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const clean = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  if (fraction.length > digits) return null;
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || 0);
}

/** "2026-10-05" → "Mon, Oct 5" (calendar date; no time zone shifts). */
export function formatDate(isoDate: string, locale = 'en-PH'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Minor units as a plain decimal string for an input field ("350000" PHP → "3500.00"). */
export function minorToInput(amountMinor: number, currency: string, locale = 'en-PH'): string {
  const digits =
    new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return (amountMinor / 10 ** digits).toFixed(digits);
}
