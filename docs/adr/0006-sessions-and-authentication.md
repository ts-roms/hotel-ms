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

## Not yet built

TOTP MFA enrolment and challenge (the `mfa_factors` table exists), step-up for sensitive
permissions, password reset, session list and revocation UI, and a Redis session cache.
