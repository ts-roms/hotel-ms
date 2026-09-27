import { z } from 'zod';
import { localDateSchema, localTimeSchema } from './common.js';
import { totpCodeSchema } from './auth.js';

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
    status: z.enum(['RESERVED', 'IN_HOUSE', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW']),
    roomNumber: z.string().nullable(),
    preCheckInCompleted: z.boolean(),
    expectedArrivalTime: z.string().nullable(),
  }),
  /** Email code confirmed in this session (needed for check-in, bill and requests). */
  verified: z.boolean(),
  /** Masked destination of the verification code, e.g. "j•••@example.com". */
  verificationDestination: z.string().nullable(),
  selfCheckInAvailable: z.boolean(),
  csrfToken: z.string(),
});
export type GuestStay = z.infer<typeof guestStaySchema>;

export const preCheckInRequestSchema = z.strictObject({
  expectedArrivalTime: localTimeSchema,
  phone: z.string().trim().max(40).nullable().default(null),
  specialRequests: z.string().trim().max(1000).default(''),
});
export type PreCheckInRequest = z.infer<typeof preCheckInRequestSchema>;

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

// ---- Service requests -----------------------------------------------------------------------

export const SERVICE_CATEGORIES = [
  'TOWELS',
  'TOILETRIES',
  'PILLOWS_BLANKETS',
  'CLEANING',
  'MAINTENANCE',
  'LAUNDRY',
  'TRANSPORT',
  'LUGGAGE',
  'WAKE_UP_CALL',
  'OTHER',
] as const;
export const SERVICE_DEPARTMENTS = [
  'HOUSEKEEPING',
  'MAINTENANCE',
  'FRONT_DESK',
  'CONCIERGE',
] as const;
export const SERVICE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const SERVICE_REQUEST_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const;

/** Where each category is routed (spec §26 workflow: guest → department → assignment). */
export const SERVICE_ROUTING: Record<
  (typeof SERVICE_CATEGORIES)[number],
  (typeof SERVICE_DEPARTMENTS)[number]
> = {
  TOWELS: 'HOUSEKEEPING',
  TOILETRIES: 'HOUSEKEEPING',
  PILLOWS_BLANKETS: 'HOUSEKEEPING',
  CLEANING: 'HOUSEKEEPING',
  LAUNDRY: 'HOUSEKEEPING',
  MAINTENANCE: 'MAINTENANCE',
  TRANSPORT: 'CONCIERGE',
  LUGGAGE: 'CONCIERGE',
  WAKE_UP_CALL: 'FRONT_DESK',
  OTHER: 'FRONT_DESK',
};

export const serviceRequestSchema = z.object({
  id: z.uuid(),
  requestNo: z.string(),
  category: z.enum(SERVICE_CATEGORIES),
  department: z.enum(SERVICE_DEPARTMENTS),
  priority: z.enum(SERVICE_PRIORITIES),
  description: z.string(),
  status: z.enum(SERVICE_REQUEST_STATUSES),
  roomNumber: z.string().nullable(),
  guestName: z.string().nullable(),
  assignee: z.object({ membershipId: z.uuid(), displayName: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  acknowledgedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  rating: z.number().int().nullable(),
  feedback: z.string().nullable(),
  version: z.number().int(),
});
export type ServiceRequest = z.infer<typeof serviceRequestSchema>;

export const guestServiceRequestCreateSchema = z.strictObject({
  category: z.enum(SERVICE_CATEGORIES),
  description: z.string().trim().max(1000).default(''),
});
export type GuestServiceRequestCreate = z.infer<typeof guestServiceRequestCreateSchema>;

export const guestServiceRatingSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
  feedback: z.string().trim().max(1000).default(''),
});
export type GuestServiceRating = z.infer<typeof guestServiceRatingSchema>;

export const staffServiceRequestCreateSchema = z.strictObject({
  category: z.enum(SERVICE_CATEGORIES),
  description: z.string().trim().min(1).max(1000),
  priority: z.enum(SERVICE_PRIORITIES).default('NORMAL'),
  roomId: z.uuid().nullable().default(null),
});
export type StaffServiceRequestCreate = z.infer<typeof staffServiceRequestCreateSchema>;

export const serviceRequestUpdateSchema = z
  .strictObject({
    status: z.enum(['ACKNOWLEDGED', 'IN_PROGRESS', 'DONE', 'CANCELLED']),
    priority: z.enum(SERVICE_PRIORITIES),
    assignedMembershipId: z.uuid().nullable(),
  })
  .partial();
export type ServiceRequestUpdate = z.infer<typeof serviceRequestUpdateSchema>;

export const serviceRequestListQuerySchema = z.object({
  status: z.enum(['ACTIVE', ...SERVICE_REQUEST_STATUSES]).default('ACTIVE'),
  department: z.enum(SERVICE_DEPARTMENTS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ServiceRequestListQuery = z.infer<typeof serviceRequestListQuerySchema>;

// ---- Feature flags ---------------------------------------------------------------------------

export const featureFlagSchema = z.object({
  key: z.string(),
  description: z.string(),
  enabled: z.boolean(),
});
export type FeatureFlag = z.infer<typeof featureFlagSchema>;

export const setFeatureFlagRequestSchema = z.strictObject({ enabled: z.boolean() });
export type SetFeatureFlagRequest = z.infer<typeof setFeatureFlagRequestSchema>;
