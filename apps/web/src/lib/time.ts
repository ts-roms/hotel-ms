import { elapsed, formatDate, localDate } from '@hotel/format';
import { t } from './i18n';

/**
 * Relative time for feeds and dashboards, built on `elapsed()` from @hotel/format. Older than a
 * day shows the date (in `timeZone`, else the viewer's zone).
 */

/** "now", "5 min", "3 h", else the date: for compact spots (badges, the bell, tickets). */
export function timeSince(iso: string, timeZone?: string, now?: number): string {
  const e = elapsed(iso, now);
  if (e.unit === 'now') return t('time.now');
  if (e.unit === 'minutes') return t('time.minutes', { count: e.value });
  if (e.unit === 'hours') return t('time.hours', { count: e.value });
  return formatDate(localDate(iso, timeZone));
}

/** "just now", "5 min ago", "3 h ago", else the date: for sentences ("Updated {time}"). */
export function timeAgo(iso: string, timeZone?: string, now?: number): string {
  const e = elapsed(iso, now);
  if (e.unit === 'now') return t('time.justNow');
  if (e.unit === 'minutes') return t('time.minutesAgo', { count: e.value });
  if (e.unit === 'hours') return t('time.hoursAgo', { count: e.value });
  return formatDate(localDate(iso, timeZone));
}
