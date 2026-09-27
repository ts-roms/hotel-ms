import argon2 from 'argon2';

/**
 * argon2id parameters (OWASP 2025 guidance: m ≥ 19 MiB, t ≥ 2). We use more memory than
 * the minimum; re-tune against production hardware so a hash takes ~50–100 ms.
 * Hashes embed their parameters, so raising them later only affects new hashes;
 * `needsRehash` lets login upgrade old ones transparently.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function passwordNeedsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verify against a fixed hash when the account does not exist, so response time does not
 * reveal whether an email is registered.
 */
export async function burnPasswordVerification(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalization');
  await argon2.verify(await dummyHash, password);
}
