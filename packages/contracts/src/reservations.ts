import { z } from 'zod';
import { amountMinorSchema, localDateSchema, MAX_STAY_NIGHTS, nightsBetween } from './common.js';
import { createGuestRequestSchema, guestSummarySchema } from './guests.js';
import { nightPriceSchema } from './pricing.js';

/**
 * Reservation contracts (blueprint §12). Stay dates are property-local calendar dates
 * "YYYY-MM-DD"; departure dates are exclusive (the guest does not stay that night).
 */

// ---- Reservations -------------------------------------------------------------------------

export const BOOKING_SOURCES = [
  'DIRECT',
  'WALK_IN',
  'PHONE',
  'WEBSITE',
  'CORPORATE',
  'TRAVEL_AGENT',
  'OTA',
] as const;
export const RESERVATION_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;
export const RESERVATION_ROOM_STATUSES = [
  'RESERVED',
  'IN_HOUSE',
  'CHECKED_OUT',
  'CANCELLED',
  'NO_SHOW',
] as const;

export const reservationRoomSchema = z.object({
  id: z.uuid(),
  roomTypeId: z.uuid(),
  roomTypeCode: z.string(),
  ratePlanId: z.uuid(),
  ratePlanCode: z.string(),
  guest: guestSummarySchema,
  arrivalDate: localDateSchema,
  departureDate: localDateSchema,
  adults: z.number().int(),
  children: z.number().int(),
  status: z.enum(RESERVATION_ROOM_STATUSES),
  assignedRoom: z.object({ roomId: z.uuid(), number: z.string() }).nullable(),
  /** Set once the guest has checked in. */
  folioId: z.uuid().nullable(),
  nights: z.array(nightPriceSchema),
  totalMinor: amountMinorSchema,
  version: z.number().int(),
});
export type ReservationRoom = z.infer<typeof reservationRoomSchema>;

export const reservationSchema = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  confirmationNo: z.string(),
  status: z.enum(RESERVATION_STATUSES),
  source: z.enum(BOOKING_SOURCES),
  externalRef: z.string().nullable(),
  specialRequests: z.string(),
  notes: z.string(),
  currency: z.string(),
  booker: guestSummarySchema,
  rooms: z.array(reservationRoomSchema),
  totalMinor: amountMinorSchema,
  cancelledAt: z.iso.datetime().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  version: z.number().int(),
});
export type Reservation = z.infer<typeof reservationSchema>;

const stayRangeRefinement = <T extends { arrivalDate?: string; departureDate?: string }>(v: T) =>
  !v.arrivalDate || !v.departureDate || v.departureDate > v.arrivalDate;

const stayLengthRefinement = <T extends { arrivalDate?: string; departureDate?: string }>(v: T) =>
  !v.arrivalDate ||
  !v.departureDate ||
  nightsBetween(v.arrivalDate, v.departureDate) <= MAX_STAY_NIGHTS;
const stayLengthMessage = {
  message: `A stay can be at most ${MAX_STAY_NIGHTS} nights`,
  path: ['departureDate'],
};

export const reservationRoomRequestSchema = z
  .strictObject({
    roomTypeId: z.uuid(),
    ratePlanId: z.uuid(),
    arrivalDate: localDateSchema,
    departureDate: localDateSchema,
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(20).default(0),
    /** Occupant; defaults to the booker. */
    guestId: z.uuid().optional(),
    /** Assign a specific room now (optional; can be done later). */
    roomId: z.uuid().optional(),
  })
  .refine(stayRangeRefinement, {
    message: 'Departure must be after arrival',
    path: ['departureDate'],
  })
  .refine(stayLengthRefinement, stayLengthMessage);
export type ReservationRoomRequest = z.infer<typeof reservationRoomRequestSchema>;

export const createReservationRequestSchema = z.strictObject({
  source: z.enum(BOOKING_SOURCES),
  externalRef: z.string().trim().max(80).nullable().default(null),
  specialRequests: z.string().trim().max(2000).default(''),
  notes: z.string().trim().max(2000).default(''),
  booker: z.union([
    z.strictObject({ guestId: z.uuid() }),
    z.strictObject({ newGuest: createGuestRequestSchema }),
  ]),
  rooms: z.array(reservationRoomRequestSchema).min(1).max(10),
});
export type CreateReservationRequest = z.infer<typeof createReservationRequestSchema>;

export const updateReservationRoomRequestSchema = z
  .strictObject({
    roomTypeId: z.uuid(),
    ratePlanId: z.uuid(),
    arrivalDate: localDateSchema,
    departureDate: localDateSchema,
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(20),
    guestId: z.uuid(),
  })
  .partial()
  .refine(stayRangeRefinement, {
    message: 'Departure must be after arrival',
    path: ['departureDate'],
  })
  .refine(stayLengthRefinement, stayLengthMessage);
export type UpdateReservationRoomRequest = z.infer<typeof updateReservationRoomRequestSchema>;

export const assignRoomRequestSchema = z.strictObject({ roomId: z.uuid() });
export type AssignRoomRequest = z.infer<typeof assignRoomRequestSchema>;

export const cancelRequestSchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export type CancelRequest = z.infer<typeof cancelRequestSchema>;

export const reservationListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  arrivalFrom: localDateSchema.optional(),
  arrivalTo: localDateSchema.optional(),
  status: z.enum(RESERVATION_ROOM_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ReservationListQuery = z.infer<typeof reservationListQuerySchema>;
