import { createHash } from 'node:crypto';
import { ProblemException, Problems } from './problem.js';

/** File types the API accepts for uploads (documents, IDs and photos). */
export type UploadType = 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';

/** The file's own bytes must match the type it claims (no HTML or scripts in disguise). */
export function matchesType(body: Buffer, type: UploadType): boolean {
  const starts = (bytes: number[], offset = 0) => bytes.every((b, i) => body[offset + i] === b);
  switch (type) {
    case 'application/pdf':
      return starts([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case 'image/png':
      return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return starts([0xff, 0xd8, 0xff]);
    case 'image/webp':
      return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8); // RIFF….WEBP
  }
}

/** 415 for a file the endpoint does not take. */
export const unsupportedFile = (detail: string) =>
  new ProblemException(415, 'UNSUPPORTED_FILE_TYPE', 'Unsupported file', detail);

export interface UploadRules<T extends UploadType> {
  /** Accepted content types; the body's bytes must match the one claimed. */
  types: readonly T[];
  maxBytes: number;
  /** What the upload is, for messages: "file", "photo", "selfie", "image". */
  label: string;
  /** Shown when the content type is not accepted, e.g. "Upload a JPEG, PNG or WebP photo." */
  typeHint: string;
}

export interface AcceptedUpload<T extends UploadType> {
  type: T;
  body: Buffer;
  /** Hex SHA-256 of the body as received. */
  sha256: string;
}

/**
 * Checks a raw upload (the request body is the file): an accepted content type, not empty,
 * within the size limit, and bytes that match the claimed type. Throws the problem the
 * client should see; returns the type, the body and its hash.
 */
export function acceptUpload<T extends UploadType>(
  contentType: string | undefined,
  body: unknown,
  rules: UploadRules<T>,
): AcceptedUpload<T> {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!(rules.types as readonly string[]).includes(type)) throw unsupportedFile(rules.typeHint);
  if (!Buffer.isBuffer(body) || body.length === 0)
    throw Problems.validation([{ path: 'body', message: `The ${rules.label} is empty` }]);
  if (body.length > rules.maxBytes) {
    const label = rules.label.charAt(0).toUpperCase() + rules.label.slice(1);
    const mib = Math.round((rules.maxBytes / (1024 * 1024)) * 10) / 10;
    throw new ProblemException(
      413,
      'VALIDATION_FAILED',
      `${label} too large`,
      `At most ${mib} MiB.`,
    );
  }
  if (!matchesType(body, type as T))
    throw unsupportedFile(`The ${rules.label}'s content is not a ${type} file.`);
  return { type: type as T, body, sha256: createHash('sha256').update(body).digest('hex') };
}
