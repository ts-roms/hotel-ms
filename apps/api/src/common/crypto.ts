import { createHash, randomBytes } from 'node:crypto';

/** Hex SHA-256; how bearer tokens (sessions, links, devices) are stored at rest. */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** 256-bit random bearer token, base64url (43 characters). */
export const newToken = () => randomBytes(32).toString('base64url');
