import { z } from 'zod';
import { amountMinorSchema, localDateSchema } from './common.js';
import { guestSummarySchema } from './guests.js';
import { signedMinorSchema } from './internal.js';
import { HOUSEKEEPING_STATUSES } from './inventory.js';

/** Front desk and night audit contracts (blueprint §12.4–12.5). */

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
