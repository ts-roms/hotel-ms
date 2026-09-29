import { z } from 'zod';
import { localDateSchema, localTimeSchema } from './common.js';
import { totpCodeSchema } from './auth.js';
import { GUEST_ID_REVIEW_STATUSES, GUEST_ID_TYPES } from './guests.js';
import { RESERVATION_ROOM_STATUSES } from './reservations.js';

/**
 * Guest portal contracts (blueprint §11, spec §23–26). Guests are a separate realm from
 * staff: a guest session is bound to exactly one reservation, and every guest endpoint
 * resolves its resources from that session, never from ids in the request.
 */

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid or expired link');

export const guestExchangeRequestSchema = z.strictObject({ token: tokenSchema });
export type GuestExchangeRequest = z.infer<typeof guestExchangeRequestSchema>;

export const guestOtpVerifyRequestSchema = z.strictObject({ code: totpCodeSchema });
export type GuestOtpVerifyRequest = z.infer<typeof guestOtpVerifyRequestSchema>;

export const guestStaySchema = z.object({
  property: z.object({
    name: z.string(),
    city: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    checkInTime: z.string(),
    checkOutTime: z.string(),
    timezone: z.string(),
  }),
  confirmationNo: z.string(),
  guest: z.object({ firstName: z.string(), lastName: z.string() }),
  stay: z.object({
    arrivalDate: localDateSchema,
    departureDate: localDateSchema,
    roomTypeName: z.string(),
    adults: z.number().int(),
    children: z.number().int(),
    status: z.enum(RESERVATION_ROOM_STATUSES),
    roomNumber: z.string().nullable(),
    preCheckInCompleted: z.boolean(),
    expectedArrivalTime: z.string().nullable(),
  }),
  /** Email code confirmed in this session (needed for check-in, bill and requests). */
  verified: z.boolean(),
  /** Masked destination of the verification code, e.g. "j•••@example.com". */
  verificationDestination: z.string().nullable(),
  selfCheckInAvailable: z.boolean(),
  /** Card hold the property asks for before self check-in; null when none is needed. */
  cardHold: z
    .object({ requiredMinor: z.number().int(), currency: z.string(), authorized: z.boolean() })
    .nullable(),
  /** The ID most recently uploaded for this stay (ADR-0027); null when none. */
  identity: z
    .object({
      documentType: z.enum(GUEST_ID_TYPES),
      status: z.enum(GUEST_ID_REVIEW_STATUSES),
      rejectionReason: z.string().nullable(),
      uploadedAt: z.iso.datetime(),
    })
    .nullable(),
  /** Self check-in needs an approved ID at this property. */
  identityRequired: z.boolean(),
  /** An open request to check out is with the front desk. */
  checkoutRequested: z.boolean(),
  unreadNotifications: z.number().int(),
  csrfToken: z.string(),
});
export type GuestStay = z.infer<typeof guestStaySchema>;

export const preCheckInRequestSchema = z.strictObject({
  expectedArrivalTime: localTimeSchema,
  phone: z.string().trim().max(40).nullable().default(null),
  specialRequests: z.string().trim().max(1000).default(''),
});
export type PreCheckInRequest = z.infer<typeof preCheckInRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type PreCheckInRequestInput = z.input<typeof preCheckInRequestSchema>;

export const roomAccessSchema = z.object({
  method: z.enum(['FRONT_DESK_KEY', 'MOBILE_KEY', 'PIN']),
  instructions: z.string(),
});
export type RoomAccess = z.infer<typeof roomAccessSchema>;

export const selfCheckInResultSchema = z.object({
  roomNumber: z.string(),
  access: roomAccessSchema,
});
export type SelfCheckInResult = z.infer<typeof selfCheckInResultSchema>;

export const guestBillSchema = z.object({
  currency: z.string(),
  balanceMinor: z.number().int(),
  lines: z.array(
    z.object({
      date: localDateSchema,
      description: z.string(),
      amountMinor: z.number().int(),
    }),
  ),
});
export type GuestBill = z.infer<typeof guestBillSchema>;

// ---- Hotel information and checkout (ADR-0027) ---------------------------------------------

const text = (max: number) => z.string().trim().max(max);

/** What the property shows guests, and its self check-in rule (property_settings). */
export const guestPortalSettingsSchema = z.strictObject({
  requireIdForSelfCheckIn: z.boolean().default(false),
  about: text(2000).default(''),
  wifiName: text(80).default(''),
  wifiPassword: text(80).default(''),
  amenities: z.array(text(80).min(1)).max(30).default([]),
  services: z
    .array(
      z.strictObject({
        name: text(80).min(1),
        description: text(300).default(''),
        hours: text(80).default(''),
      }),
    )
    .max(30)
    .default([]),
  houseRules: text(2000).default(''),
});
export type GuestPortalSettings = z.infer<typeof guestPortalSettingsSchema>;
export type GuestPortalSettingsInput = z.input<typeof guestPortalSettingsSchema>;

export const guestHotelInfoSchema = z.object({
  name: z.string(),
  address: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  checkInTime: z.string(),
  checkOutTime: z.string(),
  about: z.string(),
  /** Only for verified guests who are in house. */
  wifi: z.object({ name: z.string(), password: z.string() }).nullable(),
  amenities: z.array(z.string()),
  services: z.array(z.object({ name: z.string(), description: z.string(), hours: z.string() })),
  houseRules: z.string(),
  /** Hotel photos (ADR-0030), in display order. */
  images: z.array(z.object({ id: z.uuid(), caption: z.string(), version: z.string() })),
});
export type GuestHotelInfo = z.infer<typeof guestHotelInfoSchema>;

export const guestCheckoutRequestSchema = z.strictObject({
  /** When the guest would like to leave, property-local "HH:mm". */
  time: localTimeSchema.nullable().default(null),
  note: z.string().trim().max(500).default(''),
});
export type GuestCheckoutRequest = z.infer<typeof guestCheckoutRequestSchema>;
export type GuestCheckoutRequestInput = z.input<typeof guestCheckoutRequestSchema>;
