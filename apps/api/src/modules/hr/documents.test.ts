import { describe, expect, it } from 'vitest';
import { attachmentHeader } from './documents.controller.js';
import { matchesType } from './documents.service.js';

describe('employee document files', () => {
  it('recognizes each accepted type by its magic bytes only', () => {
    const pdf = Buffer.from('%PDF-1.7 ...');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    expect(matchesType(pdf, 'application/pdf')).toBe(true);
    expect(matchesType(png, 'image/png')).toBe(true);
    expect(matchesType(jpeg, 'image/jpeg')).toBe(true);
    expect(matchesType(webp, 'image/webp')).toBe(true);
    expect(matchesType(png, 'application/pdf')).toBe(false);
    expect(matchesType(pdf, 'image/jpeg')).toBe(false);
    expect(matchesType(Buffer.from('RIFFxxxxWAVE'), 'image/webp')).toBe(false);
    expect(matchesType(Buffer.from('<svg'), 'image/png')).toBe(false);
  });

  it('builds a safe Content-Disposition for any file name', () => {
    expect(attachmentHeader('contract.pdf')).toBe(
      `attachment; filename="contract.pdf"; filename*=UTF-8''contract.pdf`,
    );
    expect(attachmentHeader('a"b\\c ñ.pdf')).toBe(
      `attachment; filename="a_b_c _.pdf"; filename*=UTF-8''a%22b%5Cc%20%C3%B1.pdf`,
    );
  });
});
