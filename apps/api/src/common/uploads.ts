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
