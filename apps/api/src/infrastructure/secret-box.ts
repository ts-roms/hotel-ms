import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Nest injection token for the application's SecretBox. */
export const SECRET_BOX = Symbol('SECRET_BOX');

/**
 * Application-level encryption for high-sensitivity columns (blueprint §20.3), e.g. TOTP
 * secrets. AES-256-GCM with a random 96-bit IV per value.
 *
 * Keys come from DATA_ENCRYPTION_KEYS as "kid:base64key[,kid:base64key...]". The first key
 * encrypts; any listed key decrypts, so keys rotate by prepending a new one and
 * re-encrypting in the background. In AWS the keys are data keys held in Secrets Manager
 * (KMS-encrypted); moving to per-organization KMS data keys changes only this class.
 *
 * Stored format: `${kid}:` (ASCII) + iv(12) + tag(16) + ciphertext.
 */
export class SecretBox {
  private readonly keys: Map<string, Buffer>;
  private readonly currentKid: string;

  constructor(spec: string) {
    this.keys = new Map();
    for (const entry of spec
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const separator = entry.indexOf(':');
      const kid = entry.slice(0, separator);
      const key = Buffer.from(entry.slice(separator + 1), 'base64');
      if (!/^[A-Za-z0-9_-]{1,16}$/.test(kid) || key.length !== 32) {
        throw new Error('DATA_ENCRYPTION_KEYS entries must be "kid:<32 bytes base64>"');
      }
      this.keys.set(kid, key);
    }
    const first = this.keys.keys().next();
    if (first.done) throw new Error('DATA_ENCRYPTION_KEYS is empty');
    this.currentKid = first.value;
  }

  encrypt(plaintext: string, associatedData: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.currentKid)!, iv);
    // Binding to e.g. the identity id stops a ciphertext being copied to another row.
    cipher.setAAD(Buffer.from(associatedData));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from(`${this.currentKid}:`), iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(payload: Uint8Array, associatedData: string): string {
    const buffer = Buffer.from(payload);
    const separator = buffer.indexOf(':'.charCodeAt(0));
    const kid = buffer.subarray(0, separator).toString('ascii');
    const key = this.keys.get(kid);
    if (!key) throw new Error(`Unknown encryption key id "${kid}"`);
    const iv = buffer.subarray(separator + 1, separator + 13);
    const tag = buffer.subarray(separator + 13, separator + 29);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(buffer.subarray(separator + 29)),
      decipher.final(),
    ]).toString('utf8');
  }
}
