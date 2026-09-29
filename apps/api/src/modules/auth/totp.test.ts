import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateTotpSecret, hotp, verifyTotp } from './totp.js';

// RFC 4226 Appendix D and RFC 6238 Appendix B (SHA-1 seed).
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('HOTP (RFC 4226 test vectors)', () => {
  const expected = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  it.each(expected.map((code, counter) => [counter, code] as const))(
    'counter %i → %s',
    (counter, code) => {
      expect(hotp(RFC_SECRET, BigInt(counter))).toBe(code);
    },
  );
});

describe('TOTP (RFC 6238 test vectors, 8 digits, SHA-1)', () => {
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ];
  it.each(vectors)('t=%i → %s', (time, code) => {
    expect(hotp(RFC_SECRET, BigInt(Math.floor(time / 30)), 8)).toBe(code);
  });
});

describe('verifyTotp', () => {
  const secret = base32Encode(RFC_SECRET);
  const now = 1_234_567_890_000;
  const code = hotp(RFC_SECRET, BigInt(Math.floor(now / 30_000)));

  it('accepts the current code and returns its step', () => {
    expect(verifyTotp(secret, code, now)).toBe(BigInt(Math.floor(now / 30_000)));
  });

  it('tolerates one step of clock drift but not two', () => {
    expect(verifyTotp(secret, code, now + 30_000)).not.toBeNull();
    expect(verifyTotp(secret, code, now - 30_000)).not.toBeNull();
    expect(verifyTotp(secret, code, now + 60_000)).toBeNull();
  });

  it('rejects malformed codes', () => {
    expect(verifyTotp(secret, '12345', now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });
});

describe('base32', () => {
  it('round-trips generated secrets', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });
});
