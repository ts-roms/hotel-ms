import { z } from 'zod';

/**
 * Privacy tools, CSV import and images (spec §45, §74, §16; ADR-0030).
 */

// ---- Privacy: data export and anonymization --------------------------------------------------

/** Why personal data is anonymized (kept in the audit log; the data itself is not). */
export const anonymizeRequestSchema = z.strictObject({
  reason: z.string().trim().min(5).max(300),
});
export type AnonymizeRequest = z.infer<typeof anonymizeRequestSchema>;

export const anonymizeResultSchema = z.object({
  anonymizedAt: z.iso.datetime(),
  /** What was scrubbed or deleted, by kind. */
  summary: z.record(z.string(), z.number().int()),
});
export type AnonymizeResult = z.infer<typeof anonymizeResultSchema>;

// ---- CSV import ------------------------------------------------------------------------------

export const IMPORT_KINDS = ['guests', 'rooms'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** Columns per kind; `*` marks required ones (the header row names them). */
export const IMPORT_COLUMNS: Record<ImportKind, readonly string[]> = {
  guests: ['first_name*', 'last_name*', 'email', 'phone', 'country_code', 'notes'],
  rooms: ['number*', 'room_type*', 'notes'],
};

/** Largest accepted CSV: 2 MiB, 5,000 data rows. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

export const importPreviewSchema = z.object({
  /** Commit this exact preview with the token (valid for 30 minutes, once). */
  token: z.string(),
  kind: z.enum(IMPORT_KINDS),
  expiresAt: z.iso.datetime(),
  totalRows: z.number().int(),
  /** Will be created on commit. */
  newRows: z.number().int(),
  /** Already exist, or repeat an earlier row: skipped on commit. */
  duplicateRows: z.number().int(),
  /** Invalid: nothing is imported while any row has an error. */
  errorRows: z.number().int(),
  errors: z.array(
    z.object({ row: z.number().int(), column: z.string().nullable(), message: z.string() }),
  ),
  /** The first rows as they will be imported. */
  sample: z.array(
    z.object({
      row: z.number().int(),
      status: z.enum(['NEW', 'DUPLICATE', 'ERROR']),
      values: z.record(z.string(), z.string()),
    }),
  ),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const importCommitRequestSchema = z.strictObject({ token: z.string().min(10).max(100) });
export type ImportCommitRequest = z.infer<typeof importCommitRequestSchema>;

export const importResultSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  created: z.number().int(),
  skipped: z.number().int(),
});
export type ImportResult = z.infer<typeof importResultSchema>;

// ---- Images ------------------------------------------------------------------------------------

/** Accepted uploads; every image is re-encoded to WebP (metadata such as GPS removed). */
export const IMAGE_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_MAX_PER_PROPERTY = 20;

export const propertyImageSchema = z.object({
  id: z.uuid(),
  caption: z.string(),
  sortOrder: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  /** Changes when the image changes, for cache busting. */
  version: z.string(),
});
export type PropertyImage = z.infer<typeof propertyImageSchema>;

/** A menu item's new image version, for cache busting. */
export const imageVersionSchema = z.object({ imageVersion: z.string() });
export type ImageVersion = z.infer<typeof imageVersionSchema>;

export const uploadImageQuerySchema = z.object({
  caption: z.string().trim().max(200).default(''),
});
export type UploadImageQuery = z.infer<typeof uploadImageQuerySchema>;

export const updatePropertyImageRequestSchema = z
  .strictObject({
    caption: z.string().trim().max(200),
    sortOrder: z.number().int().min(0).max(1000),
  })
  .partial();
export type UpdatePropertyImageRequest = z.infer<typeof updatePropertyImageRequestSchema>;
