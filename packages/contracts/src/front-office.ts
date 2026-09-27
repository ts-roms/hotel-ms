import { z } from 'zod';
import { localDateSchema } from './common.js';
import {
  amountMinorSchema,
  guestSummarySchema,
  HOUSEKEEPING_STATUSES,
  SERVICE_STATUSES,
} from './pms.js';

/**
 * Front office, folio, housekeeping and night audit contracts (blueprint §12.4–12.5, §15).
 * Folio amounts are signed integer minor units: charges and taxes positive, payments
 * negative. A folio balance of 0 means settled.
 */

export const DEPARTMENTS = [
  'ROOM',
  'FNB',
  'MINIBAR',
  'LAUNDRY',
  'TRANSPORT',
  'SPA',
  'MISC',
] as const;
export const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'EWALLET', 'OTHER'] as const;
export const FOLIO_LINE_TYPES = [
  'CHARGE',
  'TAX',
  'PAYMENT',
  'ADJUSTMENT',
  'REVERSAL',
  'REFUND',
  'TRANSFER',
] as const;
export const HOUSEKEEPING_TASK_TYPES = [
  'CHECKOUT_CLEAN',
  'STAYOVER',
  'TOUCH_UP',
  'INSPECTION',
] as const;
export const HOUSEKEEPING_TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;

const signedMinorSchema = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);

// ---- Taxes -----------------------------------------------------------------------------

export const taxRuleSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  rateBps: z.number().int(),
  inclusive: z.boolean(),
  departments: z.array(z.enum(DEPARTMENTS)),
  archived: z.boolean(),
});
export type TaxRule = z.infer<typeof taxRuleSchema>;

export const createTaxRuleRequestSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9_]{1,16}$/),
  name: z.string().trim().min(1).max(80),
  /** Basis points: 1200 = 12%. */
  rateBps: z.number().int().min(0).max(10_000),
  /** Prices already include this tax (typical for VAT in the Philippines). */
  inclusive: z.boolean(),
  departments: z.array(z.enum(DEPARTMENTS)).min(1),
});
export type CreateTaxRuleRequest = z.infer<typeof createTaxRuleRequestSchema>;

// ---- Folio -----------------------------------------------------------------------------

export const folioLineSchema = z.object({
  id: z.uuid(),
  businessDate: localDateSchema,
  type: z.enum(FOLIO_LINE_TYPES),
  department: z.string(),
  description: z.string(),
  amountMinor: signedMinorSchema,
  taxCode: z.string().nullable(),
  parentLineId: z.uuid().nullable(),
  reversesLineId: z.uuid().nullable(),
  reversed: z.boolean(),
  reason: z.string().nullable(),
  postedAt: z.iso.datetime(),
});
export type FolioLine = z.infer<typeof folioLineSchema>;

export const paymentSchema = z.object({
  id: z.uuid(),
  method: z.enum(PAYMENT_METHODS),
  amountMinor: amountMinorSchema,
  /** Refunded so far (succeeded and pending refunds). */
  refundedMinor: amountMinorSchema,
  /** Online gateway that took the payment; null for desk payments. */
  provider: z.string().nullable(),
  reference: z.string().nullable(),
  businessDate: localDateSchema,
  createdAt: z.iso.datetime(),
});
export type Payment = z.infer<typeof paymentSchema>;

export const folioSchema = z.object({
  id: z.uuid(),
  folioNo: z.string(),
  status: z.enum(['OPEN', 'CLOSED']),
  currency: z.string(),
  balanceMinor: signedMinorSchema,
  reservationRoomId: z.uuid().nullable(),
  /** Company / group account name; null for guest folios. */
  label: z.string().nullable(),
  lines: z.array(folioLineSchema),
  payments: z.array(paymentSchema),
});
export type Folio = z.infer<typeof folioSchema>;

export const postChargeRequestSchema = z.strictObject({
  department: z.enum(DEPARTMENTS),
  description: z.string().trim().min(1).max(200),
  /** The price as charged (tax-inclusive where the department's taxes are inclusive). */
  amountMinor: amountMinorSchema.refine((v) => v > 0, 'Must be greater than zero'),
});
export type PostChargeRequest = z.infer<typeof postChargeRequestSchema>;

export const recordPaymentRequestSchema = z.strictObject({
  method: z.enum(PAYMENT_METHODS),
  amountMinor: amountMinorSchema.refine((v) => v > 0, 'Must be greater than zero'),
  /** Terminal slip, transfer or e-wallet reference. Never a card number. */
  reference: z
    .string()
    .trim()
    .max(80)
    .refine((v) => !/\d{12,}/.test(v.replace(/[\s-]/g, '')), 'Do not enter card numbers')
    .nullable()
    .default(null),
});
export type RecordPaymentRequest = z.infer<typeof recordPaymentRequestSchema>;

export const voidLineRequestSchema = z.strictObject({ reason: z.string().trim().min(1).max(200) });
export type VoidLineRequest = z.infer<typeof voidLineRequestSchema>;

export const adjustmentRequestSchema = z.strictObject({
  department: z.enum(DEPARTMENTS),
  description: z.string().trim().min(1).max(200),
  /** Signed: negative credits the guest, positive adds a charge. */
  amountMinor: signedMinorSchema.refine((v) => v !== 0, 'Must not be zero'),
  reason: z.string().trim().min(1).max(200),
});
export type AdjustmentRequest = z.infer<typeof adjustmentRequestSchema>;

// ---- Front desk -------------------------------------------------------------------------

export const frontDeskItemSchema = z.object({
  reservationId: z.uuid(),
  reservationRoomId: z.uuid(),
  confirmationNo: z.string(),
  guest: guestSummarySchema,
  roomTypeCode: z.string(),
  room: z
    .object({ id: z.uuid(), number: z.string(), housekeepingStatus: z.enum(HOUSEKEEPING_STATUSES) })
    .nullable(),
  arrivalDate: localDateSchema,
  departureDate: localDateSchema,
  adults: z.number().int(),
  children: z.number().int(),
  status: z.string(),
  folioId: z.uuid().nullable(),
  balanceMinor: signedMinorSchema.nullable(),
  currency: z.string(),
});
export type FrontDeskItem = z.infer<typeof frontDeskItemSchema>;

export const frontDeskSchema = z.object({
  businessDate: localDateSchema,
  arrivals: z.array(frontDeskItemSchema),
  inHouse: z.array(frontDeskItemSchema),
  departures: z.array(frontDeskItemSchema),
});
export type FrontDesk = z.infer<typeof frontDeskSchema>;

// ---- Housekeeping -----------------------------------------------------------------------

export const housekeepingTaskSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  roomNumber: z.string(),
  type: z.enum(HOUSEKEEPING_TASK_TYPES),
  status: z.enum(HOUSEKEEPING_TASK_STATUSES),
  businessDate: localDateSchema,
  assignee: z.object({ membershipId: z.uuid(), displayName: z.string() }).nullable(),
  notes: z.string(),
  version: z.number().int(),
});
export type HousekeepingTask = z.infer<typeof housekeepingTaskSchema>;

export const housekeepingBoardSchema = z.object({
  businessDate: localDateSchema,
  /** false when the caller only sees rooms with tasks assigned to them. */
  fullBoard: z.boolean(),
  rooms: z.array(
    z.object({
      roomId: z.uuid(),
      number: z.string(),
      roomTypeCode: z.string(),
      housekeepingStatus: z.enum(HOUSEKEEPING_STATUSES),
      serviceStatus: z.enum(SERVICE_STATUSES),
      occupied: z.boolean(),
      arrivalToday: z.boolean(),
      departureToday: z.boolean(),
      openTask: housekeepingTaskSchema.nullable(),
    }),
  ),
});
export type HousekeepingBoard = z.infer<typeof housekeepingBoardSchema>;

export const setHousekeepingStatusRequestSchema = z.strictObject({
  status: z.enum(HOUSEKEEPING_STATUSES),
  reason: z.string().trim().max(200).default(''),
});
export type SetHousekeepingStatusRequest = z.infer<typeof setHousekeepingStatusRequestSchema>;

export const createHousekeepingTaskRequestSchema = z.strictObject({
  roomId: z.uuid(),
  type: z.enum(HOUSEKEEPING_TASK_TYPES),
  notes: z.string().trim().max(500).default(''),
  assignedMembershipId: z.uuid().nullable().default(null),
});
export type CreateHousekeepingTaskRequest = z.infer<typeof createHousekeepingTaskRequestSchema>;

export const assignHousekeepingTaskRequestSchema = z.strictObject({
  assignedMembershipId: z.uuid().nullable(),
});
export type AssignHousekeepingTaskRequest = z.infer<typeof assignHousekeepingTaskRequestSchema>;

// ---- Night audit --------------------------------------------------------------------------

export const dayStatsSchema = z.object({
  currency: z.string(),
  roomsAvailable: z.number().int(),
  roomsSold: z.number().int(),
  /** Percentage with one decimal, e.g. 83.3. */
  occupancyPct: z.number(),
  roomRevenueMinor: amountMinorSchema,
  adrMinor: amountMinorSchema,
  revparMinor: amountMinorSchema,
  arrivals: z.number().int(),
  departures: z.number().int(),
  noShows: z.number().int(),
});
export type DayStats = z.infer<typeof dayStatsSchema>;

export const nightAuditPreviewSchema = z.object({
  businessDate: localDateSchema,
  /** Must be checked out (or extended) before the day can close. */
  pendingDepartures: z.array(frontDeskItemSchema),
  /** Will be marked no-show and released. */
  expectedNoShows: z.array(frontDeskItemSchema),
  inHouseCount: z.number().int(),
  canRun: z.boolean(),
});
export type NightAuditPreview = z.infer<typeof nightAuditPreviewSchema>;

export const runNightAuditRequestSchema = z.strictObject({
  /** The business date being closed; guards against running twice. */
  businessDate: localDateSchema,
});
export type RunNightAuditRequest = z.infer<typeof runNightAuditRequestSchema>;

export const businessDayClosingSchema = z.object({
  businessDate: localDateSchema,
  closedAt: z.iso.datetime(),
  stats: dayStatsSchema,
  nextBusinessDate: localDateSchema,
});
export type BusinessDayClosing = z.infer<typeof businessDayClosingSchema>;
