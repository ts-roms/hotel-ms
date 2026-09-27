import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box.js';

const key = () => randomBytes(32).toString('base64');

describe('SecretBox', () => {
  it('round-trips with the same associated data', () => {
    const box = new SecretBox(`k1:${key()}`);
    const sealed = box.encrypt('JBSWY3DPEHPK3PXP', 'identity-1');
    expect(box.decrypt(sealed, 'identity-1')).toBe('JBSWY3DPEHPK3PXP');
    expect(sealed.includes(Buffer.from('JBSWY3DPEHPK3PXP'))).toBe(false);
  });

  it('refuses a ciphertext moved to another row (associated data mismatch)', () => {
    const box = new SecretBox(`k1:${key()}`);
    const sealed = box.encrypt('secret', 'identity-1');
    expect(() => box.decrypt(sealed, 'identity-2')).toThrow();
  });

  it('detects tampering', () => {
    const box = new SecretBox(`k1:${key()}`);
    const sealed = box.encrypt('secret', 'a');
    sealed[sealed.length - 1]! ^= 1;
    expect(() => box.decrypt(sealed, 'a')).toThrow();
  });

  it('decrypts with an older key after rotation and encrypts with the newest', () => {
    const oldKey = key();
    const before = new SecretBox(`k1:${oldKey}`).encrypt('secret', 'a');
    const rotated = new SecretBox(`k2:${key()},k1:${oldKey}`);
    expect(rotated.decrypt(before, 'a')).toBe('secret');
    expect(rotated.encrypt('secret', 'a').subarray(0, 3).toString()).toBe('k2:');
  });

  it('rejects malformed key configuration', () => {
    expect(() => new SecretBox('')).toThrow();
    expect(() => new SecretBox('k1:short')).toThrow();
  });
});
