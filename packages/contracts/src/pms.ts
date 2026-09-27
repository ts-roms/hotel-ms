import { z } from 'zod';
import { countrySchema, localDateSchema } from './common.js';

/**
 * PMS contracts (blueprint §12): inventory, rates, guests, reservations.
 *
 * Money is an integer number of minor units (e.g. centavos) plus a currency; never a
 * float. Stay dates are property-local calendar dates "YYYY-MM-DD"; departure dates are
 * exclusive (the guest does not stay that night).
 */

export const amountMinorSchema = z.number().int().min(0).max(1_000_000_000_000);

const codeSchema = z
  .string()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,15}$/, 'Uppercase letters, digits, - and _ (1-16 chars)');

export const HOUSEKEEPING_STATUSES = ['DIRTY', 'CLEANING', 'CLEAN', 'INSPECTED'] as const;
export const SERVICE_STATUSES = ['IN_SERVICE', 'OUT_OF_SERVICE', 'OUT_OF_ORDER'] as const;

// ---- Physical inventory ------------------------------------------------------------------

export const buildingSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  floors: z.array(z.object({ id: z.uuid(), level: z.number().int(), name: z.string() })),
});
export type Building = z.infer<typeof buildingSchema>;

export const createBuildingRequestSchema = z.strictObject({
  code: codeSchema,
  name: z.string().trim().min(1).max(80),
  floors: z
    .array(
      z.strictObject({
        level: z.number().int().min(-5).max(200),
        name: z.string().trim().min(1).max(40),
      }),
    )
    .max(200)
    .default([]),
});
export type CreateBuildingRequest = z.infer<typeof createBuildingRequestSchema>;

export const roomTypeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  baseOccupancy: z.number().int(),
  maxOccupancy: z.number().int(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  roomCount: z.number().int(),
  version: z.number().int(),
});
export type RoomType = z.infer<typeof roomTypeSchema>;

const roomTypeFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000),
  baseOccupancy: z.number().int().min(1).max(20),
  maxOccupancy: z.number().int().min(1).max(20),
  sortOrder: z.number().int().min(0).max(1000),
};

export const createRoomTypeRequestSchema = z
  .strictObject({
    code: codeSchema,
    ...roomTypeFields,
    description: roomTypeFields.description.default(''),
    sortOrder: roomTypeFields.sortOrder.default(0),
  })
  .refine((v) => v.maxOccupancy >= v.baseOccupancy, {
    message: 'Max occupancy must be at least base occupancy',
    path: ['maxOccupancy'],
  });
export type CreateRoomTypeRequest = z.infer<typeof createRoomTypeRequestSchema>;

export const updateRoomTypeRequestSchema = z.strictObject(roomTypeFields).partial();
export type UpdateRoomTypeRequest = z.infer<typeof updateRoomTypeRequestSchema>;

export const roomSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  roomTypeId: z.uuid(),
  roomTypeCode: z.string(),
  floorId: z.uuid().nullable(),
  housekeepingStatus: z.enum(HOUSEKEEPING_STATUSES),
  serviceStatus: z.enum(SERVICE_STATUSES),
  /** An out-of-order block covers the current business date. */
  blockedToday: z.boolean(),
  notes: z.string(),
  archived: z.boolean(),
  version: z.number().int(),
});
export type Room = z.infer<typeof roomSchema>;

export const createRoomRequestSchema = z.strictObject({
  number: z.string().regex(/^[A-Za-z0-9-]{1,10}$/, 'Letters, digits and - (1-10 chars)'),
  roomTypeId: z.uuid(),
  floorId: z.uuid().nullable().default(null),
  notes: z.string().trim().max(500).default(''),
});
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;

export const updateRoomRequestSchema = z
  .strictObject({
    roomTypeId: z.uuid(),
    floorId: z.uuid().nullable(),
    notes: z.string().trim().max(500),
  })
  .partial();
export type UpdateRoomRequest = z.infer<typeof updateRoomRequestSchema>;

export const setServiceStatusRequestSchema = z.strictObject({
  status: z.enum(['IN_SERVICE', 'OUT_OF_SERVICE']),
  reason: z.string().trim().max(500).default(''),
});
export type SetServiceStatusRequest = z.infer<typeof setServiceStatusRequestSchema>;

export const roomBlockSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  startDate: localDateSchema,
  endDate: localDateSchema,
  reason: z.string().nullable(),
  released: z.boolean(),
});
export type RoomBlock = z.infer<typeof roomBlockSchema>;

export const createRoomBlockRequestSchema = z
  .strictObject({
    startDate: localDateSchema,
    endDate: localDateSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .refine((v) => v.endDate > v.startDate, {
    message: 'End date must be after start date',
    path: ['endDate'],
  });
export type CreateRoomBlockRequest = z.infer<typeof createRoomBlockRequestSchema>;

// ---- Rates -------------------------------------------------------------------------------

export const ratePlanSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  cancellationPolicy: z.string(),
  currency: z.string(),
  archived: z.boolean(),
  prices: z.array(z.object({ roomTypeId: z.uuid(), baseAmountMinor: amountMinorSchema })),
  version: z.number().int(),
});
export type RatePlan = z.infer<typeof ratePlanSchema>;

const pricesSchema = z
  .array(z.strictObject({ roomTypeId: z.uuid(), baseAmountMinor: amountMinorSchema }))
  .max(100)
  .refine((prices) => new Set(prices.map((p) => p.roomTypeId)).size === prices.length, {
    message: 'Each room type may appear once',
  });

export const createRatePlanRequestSchema = z.strictObject({
  code: codeSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).default(''),
  cancellationPolicy: z.string().trim().max(2000).default(''),
  prices: pricesSchema.default([]),
});
export type CreateRatePlanRequest = z.infer<typeof createRatePlanRequestSchema>;

export const updateRatePlanRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1000),
    cancellationPolicy: z.string().trim().max(2000),
    /** Replaces the full price list. */
    prices: pricesSchema,
  })
  .partial();
export type UpdateRatePlanRequest = z.infer<typeof updateRatePlanRequestSchema>;

export const setRateOverridesRequestSchema = z
  .strictObject({
    roomTypeId: z.uuid(),
    from: localDateSchema,
    /** Exclusive. */
    to: localDateSchema,
    /** null removes overrides in the range (back to the base price). */
    amountMinor: amountMinorSchema.nullable(),
  })
  .refine((v) => v.to > v.from, { message: 'to must be after from', path: ['to'] });
export type SetRateOverridesRequest = z.infer<typeof setRateOverridesRequestSchema>;

export const nightPriceSchema = z.object({ date: localDateSchema, amountMinor: amountMinorSchema });

export const quoteQuerySchema = z
  .object({
    roomTypeId: z.uuid(),
    ratePlanId: z.uuid(),
    arrivalDate: localDateSchema,
    departureDate: localDateSchema,
  })
  .refine((v) => v.departureDate > v.arrivalDate, {
    message: 'Departure must be after arrival',
    path: ['departureDate'],
  });
export type QuoteQuery = z.infer<typeof quoteQuerySchema>;

export const quoteSchema = z.object({
  currency: z.string(),
  nights: z.array(nightPriceSchema),
  totalMinor: amountMinorSchema,
});
export type Quote = z.infer<typeof quoteSchema>;

// ---- Availability ---------------------------------------------------------------------------

export const availabilityQuerySchema = z
  .object({ from: localDateSchema, to: localDateSchema })
  .refine((v) => v.to > v.from, { message: 'to must be after from', path: ['to'] });
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const availabilitySchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  roomTypes: z.array(
    z.object({
      roomTypeId: z.uuid(),
      code: z.string(),
      name: z.string(),
      nights: z.array(
        z.object({
          date: localDateSchema,
          capacity: z.number().int(),
          sold: z.number().int(),
          blocked: z.number().int(),
          available: z.number().int(),
        }),
      ),
    }),
  ),
});
export type Availability = z.infer<typeof availabilitySchema>;

// ---- Guests --------------------------------------------------------------------------------

export const guestSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  countryCode: z.string().nullable(),
  notes: z.string(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type Guest = z.infer<typeof guestSchema>;

export const guestSummarySchema = guestSchema.pick({
  id: true,
  firstName: true,
  lastName: true,
  email: true,
});
export type GuestSummary = z.infer<typeof guestSummarySchema>;

const guestFields = {
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.email().max(254).nullable(),
  phone: z.string().trim().max(40).nullable(),
  countryCode: countrySchema.nullable(),
  notes: z.string().trim().max(2000),
};

export const createGuestRequestSchema = z.strictObject({
  firstName: guestFields.firstName,
  lastName: guestFields.lastName,
  email: guestFields.email.default(null),
  phone: guestFields.phone.default(null),
  countryCode: guestFields.countryCode.default(null),
  notes: guestFields.notes.default(''),
});
export type CreateGuestRequest = z.infer<typeof createGuestRequestSchema>;

export const updateGuestRequestSchema = z.strictObject(guestFields).partial();
export type UpdateGuestRequest = z.infer<typeof updateGuestRequestSchema>;

export const guestSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type GuestSearchQuery = z.infer<typeof guestSearchQuerySchema>;

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
  });
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
  });
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
