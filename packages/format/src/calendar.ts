import { addDays } from './dates.js';

const DEFAULT_LOCALE = 'en-PH';

/** Monday of the (ISO) week containing a "YYYY-MM-DD" date. */
export function startOfWeek(isoDate: string): string {
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(isoDate, weekday === 0 ? -6 : 1 - weekday);
}

/** `count` consecutive calendar dates from `start` (a week by default). */
export function weekDates(start: string, count = 7): string[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/** A month number (1–12) as its name: 3 → "Mar" (`short`) or "March" (`long`). */
export function formatMonth(
  month: number,
  options: { locale?: string; style?: 'short' | 'long' } = {},
): string {
  const { locale = DEFAULT_LOCALE, style = 'short' } = options;
  return new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
}
