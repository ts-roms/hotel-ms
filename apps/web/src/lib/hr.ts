import type { EMPLOYEE_DOCUMENT_CATEGORIES, PunchType } from '@hotel/contracts';
import { formatDuration, formatTime } from '@hotel/format';
import { type MessageKey, t } from './i18n';

/** 125 → "2h 05m" (unit words from the catalog); nothing → "—". */
export function duration(minutes: number): string {
  if (!minutes) return '—';
  return formatDuration(minutes, t('time.duration'));
}

/** "2026-10-05T06:03:00.000Z" → "14:03", in `timeZone` (a property's) or on this device. */
export function clock(iso: string | null, timeZone?: string): string {
  if (!iso) return '—';
  return formatTime(iso, { hour12: false, timeZone });
}

/** Punches allowed after the last one (NONE: no punch yet). */
export const PUNCH_NEXT: Record<PunchType | 'NONE', PunchType[]> = {
  NONE: ['IN'],
  OUT: ['IN'],
  IN: ['BREAK_START', 'OUT'],
  BREAK_START: ['BREAK_END'],
  BREAK_END: ['BREAK_START', 'OUT'],
};

/** Punch button and history labels, shared by My time and the kiosk time clock. */
export const PUNCH_LABEL: Record<PunchType, MessageKey> = {
  IN: 'hr.clockIn',
  OUT: 'hr.clockOut',
  BREAK_START: 'hr.breakStart',
  BREAK_END: 'hr.breakEnd',
};

/** Employee document categories (shared by the employee file and the retention settings). */
export const DOCUMENT_CATEGORY_LABELS: Record<
  (typeof EMPLOYEE_DOCUMENT_CATEGORIES)[number],
  MessageKey
> = {
  CONTRACT: 'docCategory.CONTRACT',
  GOVERNMENT_ID: 'docCategory.GOVERNMENT_ID',
  TAX: 'docCategory.TAX',
  MEDICAL: 'docCategory.MEDICAL',
  CERTIFICATE: 'docCategory.CERTIFICATE',
  OTHER: 'docCategory.OTHER',
};
