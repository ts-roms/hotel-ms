import { z } from 'zod';
import { PUNCH_TYPES } from './hr.js';

/**
 * Shared devices (ADR-0020): a kitchen tablet paired to one property, used by staff who
 * sign in on it with a personal PIN. What an operator may do there is the intersection of
 * the device's permissions and the operator's own grants at that property.
 */

/** Permissions a device may carry. Never sensitive ones: devices have no second factor. */
export const DEVICE_PERMISSIONS = [
  'fnb.order.read',
  'fnb.order.update',
  'fnb.menu.availability',
] as const;
export type DevicePermission = (typeof DEVICE_PERMISSIONS)[number];

/**
 * KITCHEN: staff sign in with a PIN and work within the device's permissions.
 * TIME_CLOCK: no sign-in; employees punch with their Employee ID and a selfie (ADR-0022).
 */
export const DEVICE_KINDS = ['KITCHEN', 'TIME_CLOCK'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const deviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(DEVICE_KINDS),
  permissions: z.array(z.enum(DEVICE_PERMISSIONS)),
  /** PENDING: waiting for its pairing code; PAIRED: in use; REVOKED: can never sign in. */
  status: z.enum(['PENDING', 'PAIRED', 'REVOKED']),
  pairingExpiresAt: z.iso.datetime().nullable(),
  pairedAt: z.iso.datetime().nullable(),
  lastSeenAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Device = z.infer<typeof deviceSchema>;

export const createDeviceRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(DEVICE_KINDS).default('KITCHEN'),
    permissions: z.array(z.enum(DEVICE_PERMISSIONS)).default([]),
  })
  .refine((d) => (d.kind === 'KITCHEN') === d.permissions.length > 0, {
    message: 'Kitchen devices need permissions; time clocks take none',
    path: ['permissions'],
  });
export type CreateDeviceRequest = z.infer<typeof createDeviceRequestSchema>;

/** The pairing code is shown once; only its hash is stored. */
export const devicePairingSchema = z.object({
  device: deviceSchema,
  pairingCode: z.string(),
  expiresAt: z.iso.datetime(),
});
export type DevicePairing = z.infer<typeof devicePairingSchema>;

// ---- The device itself (kiosk) ----------------------------------------------------------------

export const kioskPairRequestSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^[A-Z0-9]{8}$/, 'Enter the 8-character code')),
});
export type KioskPairRequest = z.infer<typeof kioskPairRequestSchema>;

export const kioskStateSchema = z.object({
  device: z.object({
    id: z.uuid(),
    name: z.string(),
    propertyId: z.uuid(),
    propertyName: z.string(),
    kind: z.enum(DEVICE_KINDS),
    permissions: z.array(z.enum(DEVICE_PERMISSIONS)),
  }),
  /** Staff signed in on this device right now, if any. */
  operator: z
    .object({ membershipId: z.uuid(), name: z.string(), expiresAt: z.iso.datetime() })
    .nullable(),
  /** Who can sign in here: members with a PIN and a device permission at this property. */
  operators: z.array(z.object({ membershipId: z.uuid(), name: z.string() })),
  /** Days punch selfies are kept, for the notice on time clocks. */
  photoRetentionDays: z.number().int(),
  csrfToken: z.string(),
});
export type KioskState = z.infer<typeof kioskStateSchema>;

const pin = z.string().regex(/^\d{4,8}$/, 'Use 4 to 8 digits');

export const kioskSignInRequestSchema = z.strictObject({ membershipId: z.uuid(), pin });
export type KioskSignInRequest = z.infer<typeof kioskSignInRequestSchema>;

export const setPinRequestSchema = z.strictObject({
  pin,
  /** Setting a PIN needs the account password again. */
  currentPassword: z.string().min(1).max(200),
});
export type SetPinRequest = z.infer<typeof setPinRequestSchema>;

export const pinStatusSchema = z.object({ hasPin: z.boolean() });
export type PinStatus = z.infer<typeof pinStatusSchema>;

// ---- Time clock (ADR-0022) --------------------------------------------------------------------

/** Selfie formats a time clock may send (checked against the image's own bytes). */
export const CLOCK_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Largest accepted selfie: 2 MiB (a camera frame is far smaller). */
export const CLOCK_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** The punch travels in the query string; the body is the selfie itself. */
export const clockPunchQuerySchema = z.strictObject({
  /** Matched case-insensitively. */
  employeeNo: z.string().trim().min(1).max(40),
  type: z.enum(PUNCH_TYPES),
});
export type ClockPunchQuery = z.infer<typeof clockPunchQuerySchema>;

export const clockPunchResultSchema = z.object({
  /** First (or preferred) name only, for the greeting on a shared screen. */
  employeeName: z.string(),
  type: z.enum(PUNCH_TYPES),
  at: z.iso.datetime(),
});
export type ClockPunchResult = z.infer<typeof clockPunchResultSchema>;

/** A punch with its selfie, for managers reviewing punches. */
export const clockPhotoSchema = z.object({
  punchId: z.uuid(),
  employeeId: z.uuid(),
  employeeNo: z.string(),
  employeeName: z.string(),
  type: z.enum(PUNCH_TYPES),
  at: z.iso.datetime(),
  deviceName: z.string().nullable(),
  /** WEB: the employee's own session; KIOSK: a time clock. */
  source: z.enum(['WEB', 'KIOSK']),
});
export type ClockPhoto = z.infer<typeof clockPhotoSchema>;

/** How long punch selfies are kept, per organization (default 90 days). */
export const PHOTO_RETENTION_DEFAULT_DAYS = 90;
export const photoRetentionSchema = z.strictObject({
  days: z.number().int().min(7).max(365),
});
export type PhotoRetention = z.infer<typeof photoRetentionSchema>;
