# ADR-0013: Guest portal, self check-in and service requests

- Status: Accepted, 2026-09-27
- Blueprint: §11 (guest realm); spec §23 (guest portal), §24 (self check-in), §25 (room
  access), §26 (service requests)

## Decision

**A separate realm, not a staff session with fewer permissions.**

- Guests have their own tables (`guest_portal_links`, `guest_sessions`), cookie
  (`__Host-hotel_guest`), CSRF token (HMAC of `guest-csrf:` + the session token hash) and
  guard (`GuestGuard`).
- Guest routes live under `/api/v1/guest/*` and are marked `@GuestRoute()`. The staff
  guards (Auth, Tenant, Permission) stand aside for them; `GuestGuard` authenticates them
  instead. The Origin check for unsafe methods still runs first, and `GUEST_ORIGIN` is an
  allowed origin.
- Staff routes never accept a guest cookie, and guest routes never accept a staff cookie.
  The route inventory test checks both for every guest route.
- A guest session is bound to one reservation room line. No guest route takes a property,
  reservation or line id. Everything is resolved from the session. A guest can reach
  another booking only by holding that booking's link.

**Link → session.**

- Staff with `guest_portal.invite` email the booker a link: `/welcome#token=…`, 32 random
  bytes. The token sits in the URL fragment, so it never reaches server logs or `Referer`.
- Only its SHA-256 hash is stored.
- A new link revokes the previous one. Links expire two days after the last departure.
- Exchanging the link creates a guest session with its own token (the cookie), capped at 30
  days and at the link's expiry. Exchanges are rate limited per IP.

**Tenant context without a tenant.**

- Before a guest is authenticated there is no organization context. Two narrow RLS
  policies make exactly one row visible:
  - `by_link_token` on links, keyed by `app.guest_link_hash`;
  - `by_session_token` on sessions, keyed by `app.guest_session_hash`.
- `TenantDb.runWithGuestToken` sets these. The organization and property then come from
  that row, like the staff session's server-side organization.
- The table grants are column-limited. The app role can UPDATE only
  `revoked_at`/`verified_at`/`last_seen_at`.

**Two assurance levels.**

- Holding the link lets a guest view the stay and do pre-check-in: arrival time, phone and
  requests.
- Self check-in, the bill and service requests also need a 6-digit code emailed to the
  booker's address. The code is kept as a hash in Redis for 10 minutes and works once.
  Sending and verifying are rate limited and fail closed when Redis is down.
- A forwarded booking email alone therefore cannot check anyone in or read the bill.

**Self check-in reuses the front desk.**

- The guest flow adds its own gates first:
  - the organization's `self_checkin` feature flag;
  - a verified session;
  - arrival day = business date;
  - property-local time ≥ the property's check-in time.
- It then auto-assigns a ready room of the booked type: inspected first, then clean, in
  service, not occupied, free for the whole stay. A concurrent assignment loses on the
  existing exclusion constraint, and the next candidate is tried.
- Finally it calls `FrontOfficeService.checkIn`, the same code and rules as the desk.
- Any refusal becomes `409 SEE_FRONT_DESK` with a guest-readable reason. Nothing is
  bypassed.
- Audit and outbox rows are attributed to `actorType = GUEST` with the guest id
  (`actorOf()`).

**Room access is a port.** `RoomAccessProvider` (spec §25) issues access for a stay. The
only provider so far is `FrontDeskKeyProvider`: collect a key card at the desk. Lock
vendors or mobile keys plug in behind the same interface, per property, later.

**Service requests.**

- Created by an in-house guest (up to 10 open at a time) or by staff for a room. Staff
  requests attach the in-house guest, if there is one.
- Each category routes to a department (`SERVICE_ROUTING`).
- Status flow: open → acknowledged → in progress → done or cancelled. Closed requests are
  final. Updates use If-Match.
- Assignees must be active members holding `guest_service.update` for the property.
- The guest can rate a completed request once.
- Numbering (`SR-000001`) is per property.

**Permissions.**

- `guest_service.read` and `guest_service.update`.
- `guest_portal.invite`: front desk and managers.
- Housekeeping supervisors work the queue; auditors can read it.
- `feature_flag.manage` (org scope) toggles `self_checkin` through
  `PUT /organization/feature-flags/:key`.

**Guest app.**

- `apps/guest` is a separate Next.js PWA with a manifest, on port 43200 locally. It
  proxies only `/api/v1/guest/*`, so staff endpoints are not reachable through the guest
  origin at all.
- It sends `Referrer-Policy: no-referrer`.

## Consequences

- Tests cover:
  - realm separation both ways;
  - CSRF and Origin;
  - link revocation;
  - RLS visibility of sessions and links without the token, with a wrong hash and from
    another tenant;
  - verification;
  - every self check-in gate;
  - GUEST audit attribution;
  - the request lifecycle with version conflicts;
  - assignee rules;
  - cross-guest isolation.
- Deployment:
  - The guest app runs as its own ECS service on its own host name (`guest_domain_name`),
    behind the same ALB and WAF.
  - On that host, only `/api/v1/guest/*` reaches the API. Every other API path answers
    404, so staff endpoints are unreachable through the guest origin, as in local
    development.
  - The deploy workflow builds and rolls out the `guest` image. The smoke test checks the
    guest app, the guest API (401) and the blocked staff API (404).
  - After applying Terraform, refresh the `DEPLOY_CONFIG` GitHub variable: it now carries
    `guest_url`.
  - Point the guest DNS name at the ALB, and cover it with `certificate_arn` or
    `guest_certificate_arn`.
- Not built yet:
  - identity document capture and registration cards (need S3 and retention rules);
  - online payment of the bill;
  - push notifications for request updates;
  - room moves for in-house guests (still refused, ADR-0012).
