# ADR-0020: Shared kitchen devices and staff PINs

- Status: Accepted, 2026-09-28
- Blueprint: §8 (access control), §10 (authentication), §14 (F&B kitchen display)
- Builds on ADR-0004 (property-scoped RBAC), ADR-0006 (sessions)

## Context

A kitchen tablet is shared by a whole shift. Staff sessions (email, password, maybe MFA)
suit neither the device nor the cooks. Some other options:

- a shared "kitchen" account, which hides who did what;
- leaving someone's session open, which lends that person's full rights to everyone.

## Decision

**A device is registered and paired, never logged in.**

- A manager with `device.manage` at the property registers the device:
  - it gets a name and a permission set, chosen from `DEVICE_PERMISSIONS`: order read,
    order update, sold-out;
  - sensitive permissions are never possible, because devices have no second factor;
  - a database check enforces the same list.
- Registering shows a one-time **pairing code**:
  - 8 characters, no ambiguous ones (0/O, 1/I/L);
  - valid for 15 minutes; only its SHA-256 is stored;
  - redeeming it is rate-limited per IP, fail-closed.
- The browser opens `/kiosk` and enters the code. It then receives the **device token**:
  - a 32-byte random value in an HttpOnly, `SameSite=Strict` cookie, `__Host-` in
    production;
  - only its hash is stored;
  - a code works once (a conditional update).
- A new pairing code replaces the old token. Revoking ends the device for good. Both end
  any operator session on it.
- The device finds its row before any tenant is known, through a lookup-only RLS policy
  (`by_device_token`): the hash in `app.device_token_hash` exposes exactly that row,
  read-only. The pattern is the same as payment references. Everything else then runs in
  the device's organization.

**Staff sign in on the device with a personal PIN.**

- Members set a 4–8 digit PIN on the Security page. It needs the account password, and
  trivial PINs (1111, 1234) are refused.
- The PIN is hashed like a password (`staff_pins`, per membership). Setting or removing
  it ends that member's device sessions.
- The kiosk lists who may sign in there: active members with a PIN who hold one of the
  device's permissions at its property.
- Wrong PINs are counted two ways, so neither a person nor a tablet can be used to guess:
  - per member: locked for 15 minutes after 5 misses;
  - per device: 20 attempts per 5 minutes.
- An **operator session** is a second cookie, `hotel_kiosk`:
  - idle timeout 30 minutes, absolute limit 12 hours;
  - one operator per device, so signing in ends the previous operator's session.

**What an operator can do is an intersection.**

- The device realm lives in `AuthGuard`. It runs when a kiosk operator cookie is present,
  or when a device cookie is present without a staff session.
- It sets the operator's identity, and the organization from the device row. CSRF tokens
  are derived from the device token.
- `TenantGuard` narrows the grants with `GrantSet.restrictTo`: the device's permissions,
  plus `property.read`, only where the operator holds them, only at the device's property.
- Any other property answers 404. Organization-wide, account and session routes answer
  401 or 404.
- The route-inventory isolation suite checks every such route against a signed-in device.
  A new route is covered without anyone remembering it.
- Audit entries keep the operator as the actor and add the new `audit_logs.device_id`.
  Pairing and sign-in events are recorded as SYSTEM actions on the device.

## Consequences

- A kiosk browser is dedicated. While an operator is signed in there, the device realm
  wins over a staff session in the same browser. It can only narrow access, but it also
  means the staff app is not usable in that browser at the same time.
- A member without a PIN simply does not appear on devices. HR offboarding (membership
  deactivated) removes them at once, because every request re-checks the membership.
- Other shared devices (for example a housekeeping tablet) only need their permissions
  added to `DEVICE_PERMISSIONS` and to the database check.
