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
  /** Card hold the property asks for before self check-in; null when none is needed. */
  cardHold: z
    .object({ requiredMinor: z.number().int(), currency: z.string(), authorized: z.boolean() })
    .nullable(),
  /** The ID most recently uploaded for this stay (ADR-0027); null when none. */
  identity: z
    .object({
      documentType: z.enum(['PASSPORT', 'DRIVERS_LICENSE', 'NATIONAL_ID', 'OTHER']),
      status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
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
  /** Made through "Request checkout", not the general request form. */
  'CHECKOUT',
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
  CHECKOUT: 'FRONT_DESK',
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
  category: z.enum(SERVICE_CATEGORIES).exclude(['CHECKOUT']),
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

// ---- Guest ID, hotel information, notifications, checkout (ADR-0027) -----------------------

export const GUEST_ID_TYPES = ['PASSPORT', 'DRIVERS_LICENSE', 'NATIONAL_ID', 'OTHER'] as const;
export type GuestIdType = (typeof GUEST_ID_TYPES)[number];
/** File types accepted for a guest ID (checked against the file's own bytes). */
export const GUEST_ID_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
/** Largest accepted ID file: 8 MiB. */
export const GUEST_ID_MAX_BYTES = 8 * 1024 * 1024;
export const GUEST_ID_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const;

export const uploadGuestIdQuerySchema = z.object({ documentType: z.enum(GUEST_ID_TYPES) });
export type UploadGuestIdQuery = z.infer<typeof uploadGuestIdQuerySchema>;

/** A guest ID as the front desk reviews it. */
export const identityDocumentSchema = z.object({
  id: z.uuid(),
  reservationId: z.uuid(),
  reservationRoomId: z.uuid(),
  confirmationNo: z.string(),
  guestName: z.string(),
  arrivalDate: localDateSchema,
  departureDate: localDateSchema,
  stayStatus: z.string(),
  documentType: z.enum(GUEST_ID_TYPES),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(GUEST_ID_STATUSES),
  rejectionReason: z.string().nullable(),
  uploadedAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
  reviewerName: z.string().nullable(),
  /** The file was deleted under the retention rule; the review record remains. */
  purged: z.boolean(),
  version: z.number().int(),
});
export type IdentityDocument = z.infer<typeof identityDocumentSchema>;

export const identityDocumentListQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'ALL']).default('PENDING'),
});
export type IdentityDocumentListQuery = z.infer<typeof identityDocumentListQuerySchema>;

export const identityReviewSchema = z
  .strictObject({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().max(300).default(''),
  })
  .refine((r) => r.decision === 'APPROVE' || r.reason.length >= 3, {
    message: 'Tell the guest why',
    path: ['reason'],
  });
export type IdentityReview = z.infer<typeof identityReviewSchema>;
export type IdentityReviewInput = z.input<typeof identityReviewSchema>;

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

export const GUEST_NOTIFICATION_KINDS = [
  'SERVICE_REQUEST',
  'ORDER',
  'IDENTITY',
  'CHECKOUT',
  'MESSAGE',
] as const;
export type GuestNotificationKind = (typeof GUEST_NOTIFICATION_KINDS)[number];

export const guestNotificationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(GUEST_NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  read: z.boolean(),
});
export type GuestNotification = z.infer<typeof guestNotificationSchema>;

export const guestCheckoutRequestSchema = z.strictObject({
  /** When the guest would like to leave, property-local "HH:mm". */
  time: localTimeSchema.nullable().default(null),
  note: z.string().trim().max(500).default(''),
});
export type GuestCheckoutRequest = z.infer<typeof guestCheckoutRequestSchema>;
export type GuestCheckoutRequestInput = z.input<typeof guestCheckoutRequestSchema>;

/** The front desk writes to a guest's portal feed. */
export const staffGuestMessageSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(1000).default(''),
});
export type StaffGuestMessage = z.infer<typeof staffGuestMessageSchema>;
export type StaffGuestMessageInput = z.input<typeof staffGuestMessageSchema>;
