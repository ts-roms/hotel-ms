const DEFAULT_LOCALE = 'en-PH';

/** "2026-10-05" → "Mon, Oct 5" (calendar date; no time zone shifts). */
export function formatDate(isoDate: string, locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** Calendar arithmetic on "YYYY-MM-DD" strings. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * An instant as date and time ("10/5/2026, 2:30:00 PM"). Pass the property's time zone to
 * show property time; without it the viewer's own time zone is used.
 */
export function formatDateTime(
  iso: string,
  options: { timeZone?: string; locale?: string } = {},
): string {
  const { timeZone, locale = DEFAULT_LOCALE } = options;
  return new Date(iso).toLocaleString(locale, timeZone ? { timeZone } : undefined);
}

/** The calendar date ("YYYY-MM-DD") of an instant, in `timeZone` or the viewer's zone. */
export function localDate(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleDateString('en-CA', timeZone ? { timeZone } : undefined);
}
