import { z } from 'zod';
import { countrySchema, localDateSchema } from './common.js';

/** Guest contracts (blueprint §12): guest profiles and guest ID documents. */

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
/** What a client sends: fields with defaults may be left out. */
export type CreateGuestRequestInput = z.input<typeof createGuestRequestSchema>;

export const updateGuestRequestSchema = z.strictObject(guestFields).partial();
export type UpdateGuestRequest = z.infer<typeof updateGuestRequestSchema>;

export const guestSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type GuestSearchQuery = z.infer<typeof guestSearchQuerySchema>;

// ---- Guest ID documents (ADR-0027) -----------------------------------------------------------

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
/** Where a guest ID's review stands. */
export const GUEST_ID_REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
/** SUPERSEDED: a newer upload for the same stay replaced it. */
export const GUEST_ID_STATUSES = [...GUEST_ID_REVIEW_STATUSES, 'SUPERSEDED'] as const;

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
  status: z.enum([...GUEST_ID_REVIEW_STATUSES, 'ALL']).default('PENDING'),
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
