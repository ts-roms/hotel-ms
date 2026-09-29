import { createHash } from 'node:crypto';
import { IMAGE_MAX_BYTES, IMAGE_UPLOAD_TYPES } from '@hotel/contracts';
import sharp from 'sharp';
import { acceptUpload, unsupportedFile } from '../common/uploads.js';

/** Longest side of a stored image, in pixels. */
const MAX_SIDE = 1600;

export interface StoredImage {
  body: Buffer;
  sha256: string;
  width: number;
  height: number;
}

/**
 * Checks an uploaded image and re-encodes it (ADR-0030): JPEG, PNG or WebP whose bytes
 * match the claimed type, at most 8 MiB, decoded with a pixel limit; turned upright, scaled
 * to fit 1600 px, and written as WebP. Re-encoding drops every metadata block (EXIF GPS
 * location, camera serials) and anything smuggled after the image data.
 */
export async function processImage(
  contentType: string | undefined,
  body: unknown,
): Promise<StoredImage> {
  const upload = acceptUpload(contentType, body, {
    types: IMAGE_UPLOAD_TYPES,
    maxBytes: IMAGE_MAX_BYTES,
    label: 'image',
    typeHint: 'Upload a JPEG, PNG or WebP image.',
  });
  try {
    const { data, info } = await sharp(upload.body, {
      limitInputPixels: 50_000_000,
      failOn: 'error',
    })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return {
      body: data,
      sha256: createHash('sha256').update(data).digest('hex'),
      width: info.width,
      height: info.height,
    };
  } catch {
    throw unsupportedFile('The image could not be read.');
  }
}
