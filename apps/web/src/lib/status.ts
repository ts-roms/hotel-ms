import type {
  APPROVAL_STATUSES,
  ATTENDANCE_DAY_STATUSES,
  EMPLOYEE_STATUSES,
  HOUSEKEEPING_STATUSES,
  MEMBERSHIP_STATUSES,
  ORDER_STATUSES,
  RESERVATION_ROOM_STATUSES,
  RESERVATION_STATUSES,
  SERVICE_PRIORITIES,
  SERVICE_REQUEST_STATUSES,
  SERVICE_STATUSES,
  SHIFT_STATUSES,
} from '@hotel/contracts';
import type { BadgeVariant } from '@hotel/ui';
import { en } from '@hotel/i18n/staff';
import { type MessageKey, t } from './i18n';

type Values<T extends readonly string[]> = T[number];

/** Every status value the staff app renders as a badge, taken from the contract enums. */
type KnownStatus =
  | Values<typeof HOUSEKEEPING_STATUSES>
  | Values<typeof SERVICE_STATUSES>
  | Values<typeof RESERVATION_STATUSES>
  | Values<typeof RESERVATION_ROOM_STATUSES>
  | Values<typeof MEMBERSHIP_STATUSES>
  | Values<typeof SERVICE_REQUEST_STATUSES>
  | Values<typeof SERVICE_PRIORITIES>
  | Values<typeof ORDER_STATUSES>
  | Values<typeof APPROVAL_STATUSES>
  | Values<typeof SHIFT_STATUSES>
  | Values<typeof ATTENDANCE_DAY_STATUSES>
  | Values<typeof EMPLOYEE_STATUSES>
  // Folio status is an inline enum in the contracts ('OPEN' | 'CLOSED').
  | 'CLOSED';

/** Badge colors for the statuses shown across the staff app. Unknown values stay neutral. */
const STATUS_VARIANTS: Partial<Record<KnownStatus, BadgeVariant>> = {
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
  // F&B orders (PENDING, CONFIRMED and CANCELLED are shared above/below)
  PREPARING: 'warning',
  READY: 'success',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'neutral',
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
  return STATUS_VARIANTS[status as KnownStatus] ?? 'neutral';
}

/** Enum label families in the staff catalog: `<family>.<RAW_VALUE>` keys. */
export type LabelFamily =
  | 'status'
  | 'priority'
  | 'category'
  | 'department'
  | 'employmentType'
  | 'trainingKind'
  | 'calendarKind'
  | 'hkTask'
  | 'folioLine'
  | 'idType'
  | 'paymentMethod'
  | 'bookingSource'
  | 'leaveKind'
  | 'docCategory'
  | 'devicePerm';

/** The raw values a family has labels for, e.g. `LabelValue<'priority'>` = 'LOW' | 'NORMAL' | … */
export type LabelValue<F extends LabelFamily> = MessageKey extends infer K
  ? K extends `${F}.${infer V}`
    ? V
    : never
  : never;

/**
 * The catalog label of an enum value (IN_HOUSE → "In house"). Typed: a value without a label in
 * its family does not compile, so a new enum value needs a catalog entry.
 */
export function enumLabel<F extends LabelFamily>(family: F, value: LabelValue<F>): string {
  return t(`${family}.${value}` as MessageKey);
}

/** The label of a status (reservation, room, order, request, approval, …). */
export function statusLabel(status: LabelValue<'status'>): string {
  return enumLabel('status', status);
}

/**
 * For values the API types as plain strings (report rows): the label when the catalog has one,
 * else the value as sent.
 */
export function enumLabelOr<F extends LabelFamily>(family: F, value: string): string {
  const key = `${family}.${value}`;
  return Object.hasOwn(en, key) ? t(key as MessageKey) : value;
}
