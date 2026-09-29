import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ProblemException } from './problem.js';
import { acceptUpload, matchesType } from './uploads.js';

const pdf = Buffer.from('%PDF-1.7 ...');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

describe('matchesType', () => {
  it('recognizes each accepted type by its magic bytes only', () => {
    expect(matchesType(pdf, 'application/pdf')).toBe(true);
    expect(matchesType(png, 'image/png')).toBe(true);
    expect(matchesType(jpeg, 'image/jpeg')).toBe(true);
    expect(matchesType(webp, 'image/webp')).toBe(true);
    expect(matchesType(png, 'application/pdf')).toBe(false);
    expect(matchesType(pdf, 'image/jpeg')).toBe(false);
    expect(matchesType(Buffer.from('RIFFxxxxWAVE'), 'image/webp')).toBe(false);
    expect(matchesType(Buffer.from('<svg'), 'image/png')).toBe(false);
  });
});

describe('acceptUpload', () => {
  const rules = {
    types: ['image/jpeg', 'image/png'] as const,
    maxBytes: 16,
    label: 'photo',
    typeHint: 'Upload a JPEG or PNG photo.',
  };
  const problem = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      if (error instanceof ProblemException) return { status: error.status, code: error.code };
      throw error;
    }
    throw new Error('expected a problem');
  };

  it('returns the type without parameters, the body and its hash', () => {
    const accepted = acceptUpload('Image/PNG; charset=binary', png, rules);
    expect(accepted).toEqual({
      type: 'image/png',
      body: png,
      sha256: createHash('sha256').update(png).digest('hex'),
    });
  });

  it('refuses other types, empty and oversized bodies, and bytes of another type', () => {
    expect(problem(() => acceptUpload('application/pdf', pdf, rules))).toEqual({
      status: 415,
      code: 'UNSUPPORTED_FILE_TYPE',
    });
    expect(problem(() => acceptUpload(undefined, png, rules)).status).toBe(415);
    expect(problem(() => acceptUpload('image/png', Buffer.alloc(0), rules))).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(problem(() => acceptUpload('image/png', 'not a buffer', rules)).status).toBe(400);
    expect(
      problem(() => acceptUpload('image/png', Buffer.concat([png, Buffer.alloc(16)]), rules)),
    ).toEqual({ status: 413, code: 'VALIDATION_FAILED' });
    expect(problem(() => acceptUpload('image/jpeg', png, rules)).status).toBe(415);
  });
});
