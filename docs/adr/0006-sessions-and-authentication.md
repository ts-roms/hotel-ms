# ADR-0006: Opaque server-side sessions, CSRF, lockout

- Status: Accepted, 2026-09-27
- Blueprint: §10

## Decision

- A 256-bit random token lives in an HttpOnly, SameSite=Lax cookie (`__Host-hotel_sid`
  when secure). Only its SHA-256 is stored, in `sessions`. Revocation is immediate.
- Idle timeout (sliding) and absolute lifetime are both configured by env.
- CSRF protection for unsafe methods has two parts. The `Origin` header must be an allowed web
  origin. `X-CSRF-Token` must equal `HMAC(secret, tokenHash)`, which the client gets from the
  session response. The token rotates with the session token.
- Switching organization rotates the session token.
- Passwords are argon2id (64 MiB, t=3) and rehashed on login when the parameters change. Unknown
  accounts get a dummy verification to equalize timing. Locked, disabled, unknown and
  wrong-password all return the same `INVALID_CREDENTIALS`.
- Lockout: 5 failures → 15 minutes. Redis rate limits: 30 logins/min per IP and 10 per
  15 min per email. Rate limits fail open if Redis is down; lockout does not.
- The browser reaches the API same-origin through the Next.js `/api/v1` proxy, so the
  cookie is first-party.

## Multi-factor authentication (Phase 1)

- TOTP per RFC 6238 (SHA-1, 30 s, 6 digits, ±1 step), implemented on `node:crypto` and tested
  against the RFC vectors. The secret is encrypted with AES-256-GCM (`SecretBox`), using
  the identity id as associated data. Keys are `DATA_ENCRYPTION_KEYS`, rotatable.
- **Replay protection**: `last_used_step` is claimed atomically, so a code works once even
  under concurrent use.
- 10 single-use **recovery codes**, stored as SHA-256.
- A password-only session is **MFA-pending**. Only the challenge, session info and logout
  work, and the session info reveals no memberships or grants. Completing MFA rotates the
  session token.
- Enrolling signs out every other session. Enabling and disabling MFA both send an email.
- MFA attempts: 5 per 5 minutes per identity, **failing closed** if Redis is down.
- **Platform minimum**: permissions marked `sensitive` (role.manage, role.assign, audit.read)
  only work from an MFA-verified session. The check runs after the grant check, so callers
  without the permission see a plain 403.

## Passwords and invitations (Phase 1)

- The reset link is a random 256-bit token, stored as SHA-256. It expires in 30 minutes and
  works once. A new request invalidates older links. The token is carried in the URL
  **fragment** (`#token=`), so it never reaches server logs or Referer headers. Resetting
  signs out every session and clears any lockout.
- "Forgot password" answers the same for known and unknown emails.
- Changing a password requires the current one and signs out the other sessions.
- Policy: 12–256 characters, and no email local part in the password (NIST 800-63B style).
  Breached-password screening is not implemented yet.
- **Invitations** carry a 7-day single-use token. Without a session, the database exposes
  exactly one invitation, the one matching the presented token hash, through the RLS policy
  `invitation_by_token`. The organization context is taken from that row. New people choose
  a password on acceptance. Existing identities keep theirs.
- Emails go through the `notifications` BullMQ queue to the worker. Transports are SES in the
  cloud and a local file mailbox in development. Jobs holding links are removed on
  completion.

## Not yet built

WebAuthn/passkeys, step-up re-authentication for individual sensitive actions, a session
list and revocation UI, breached-password screening, and a Redis session cache.
