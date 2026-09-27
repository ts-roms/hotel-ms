import type { BadgeVariant } from '@hotel/ui';

/** Badge colors for the statuses shown across the staff app. Unknown values stay neutral. */
const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  // Housekeeping
  DIRTY: 'danger',
  CLEANING: 'warning',
  CLEAN: 'info',
  INSPECTED: 'success',
  // Room service
  IN_SERVICE: 'neutral',
  OUT_OF_SERVICE: 'warning',
  OUT_OF_ORDER: 'danger',
  // Reservations and stays
  CONFIRMED: 'primary',
  RESERVED: 'info',
  IN_HOUSE: 'success',
  CHECKED_OUT: 'neutral',
  CANCELLED: 'danger',
  NO_SHOW: 'warning',
  // Memberships
  ACTIVE: 'success',
  INVITED: 'info',
  SUSPENDED: 'warning',
  // Folios and service requests
  OPEN: 'primary',
  CLOSED: 'neutral',
  ACKNOWLEDGED: 'info',
  IN_PROGRESS: 'warning',
  DONE: 'success',
  // Service request priority
  LOW: 'neutral',
  NORMAL: 'primary',
  HIGH: 'warning',
  URGENT: 'danger',
  // HR: approvals, shifts, attendance, employees
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  DRAFT: 'neutral',
  PUBLISHED: 'primary',
  PRESENT: 'success',
  ABSENT: 'danger',
  INCOMPLETE: 'warning',
  ON_LEAVE: 'info',
  SCHEDULED: 'neutral',
  TERMINATED: 'neutral',
};

export function statusVariant(status: string): BadgeVariant {
  return STATUS_VARIANTS[status] ?? 'neutral';
}

/** IN_HOUSE → "In house". */
export function statusLabel(status: string): string {
  const words = status.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
