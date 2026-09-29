import type { EMPLOYEE_DOCUMENT_CATEGORIES, PunchType } from '@hotel/contracts';
import { addDays, formatTime } from '@hotel/format';

/** Today's calendar date on this device. */
export function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 125 → "2h 05m". */
export function duration(minutes: number): string {
  if (!minutes) return '—';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** "2026-10-05T06:03:00.000Z" → "14:03" on this device. */
export function clock(iso: string | null): string {
  if (!iso) return '—';
  return formatTime(iso, { hour12: false });
}

/** Punches allowed after the last one (NONE: no punch yet). */
export const PUNCH_NEXT: Record<PunchType | 'NONE', PunchType[]> = {
  NONE: ['IN'],
  OUT: ['IN'],
  IN: ['BREAK_START', 'OUT'],
  BREAK_START: ['BREAK_END'],
  BREAK_END: ['BREAK_START', 'OUT'],
};

/** Employee document categories (shared by the employee file and the retention settings). */
export const DOCUMENT_CATEGORY_LABELS: Record<
  (typeof EMPLOYEE_DOCUMENT_CATEGORIES)[number],
  string
> = {
  CONTRACT: 'Contract',
  GOVERNMENT_ID: 'Government ID',
  TAX: 'Tax',
  MEDICAL: 'Medical',
  CERTIFICATE: 'Certificate',
  OTHER: 'Other',
};
