const DEFAULT_LOCALE = 'en-PH';

/**
 * A duration in minutes as hours and zero-padded minutes: 125 → "2h 05m". The pattern carries
 * the unit words, so apps pass it from their catalog; `{hours}` and `{minutes}` are filled.
 */
export function formatDuration(totalMinutes: number, pattern = '{hours}h {minutes}m'): string {
  const sign = totalMinutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(totalMinutes));
  return (
    sign +
    pattern
      .replace('{hours}', String(Math.floor(abs / 60)))
      .replace('{minutes}', String(abs % 60).padStart(2, '0'))
  );
}

/** A file size: under 1 MB in whole kilobytes (rounded up), else megabytes with one decimal. */
export function formatBytes(bytes: number, locale = DEFAULT_LOCALE): string {
  const mb = 1024 * 1024;
  const [value, unit, digits] =
    bytes < mb ? [Math.ceil(bytes / 1024), 'kilobyte', 0] : [bytes / mb, 'megabyte', 1];
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
