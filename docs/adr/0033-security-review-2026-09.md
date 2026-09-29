# ADR-0033: Security review, September 2026

- Status: Accepted, 2026-09-29
- Scope: the whole platform before its first real deploy, now that it takes money
  (ADR-0032)

## Review

Read-only reviews of six areas, each finding checked against the code before any change:

1. tenant isolation (RLS policies, grants, worker);
2. staff authentication, authorization and sessions;
3. the guest portal;
4. files, CSV import, exports and input limits;
5. payments, the web apps and deployment;
6. cross-property access within one organization, route by route, for every module.

There were no critical or high findings. Cross-organization isolation held everywhere.
Every `/properties/:propertyId` route checks sub-resource ids from the path and the body
against the route property, and every `'any'` route filters by the caller's scope.

## Fixed

**Money**

- A refund whose provider call times out or fails without a clear answer used to become
  `FAILED`. That freed the amount for a second refund, which could go out for real if the
  first had succeeded. Now only an explicit refusal (`PAYMENT_PROVIDER_REJECTED`) fails a
  refund. An unknown outcome stays `PENDING`: it still counts against the cap and shows as
  `PENDING_REFUND` in reconciliation.

**Staff access**

- **MFA enrollment** requires the current password. Before this, someone holding only a
  session cookie could attach their own authenticator, which unlocked sensitive
  permissions and signed the real user out.
- **Suspended organizations** stop working for sessions and devices already bound to
  them. Previously only sign-in checked the status.
- **Suspending or reactivating a member** requires MFA, and the member's roles must be ones
  the actor could grant. An HR-style role can no longer reactivate a suspended
  administrator.
- **Kiosk PINs** can no longer be brute-forced:
  - the attempt is claimed atomically, and the lock is enforced in the same `UPDATE`, so
    parallel guesses cannot pass it;
  - every 5th miss locks the PIN, twice as long each time (15 minutes up to a day);
  - only a correct PIN resets the count.

  Kiosk operator sessions also end when the identity is disabled.
- **HR assignments.** Adding an assignment now needs `employee.manage` over the employee,
  not just `employee.read`. Past assignments give lasting HR coverage (ADR-0014), so a
  backdated assignment used to be a way to reach another property's employee file.

**Guest portal**

- Re-sending the portal link revokes the sessions opened from the old link. Cancelling a
  stay revokes its sessions, and cancelling the whole booking also revokes its links.
- Verification codes are limited per booking as well as per session (6 sends and 15
  checks per hour). A fresh session no longer resets the budget or floods the booker's
  inbox.
- An unverified session (a forwarded link) no longer sees the room number or staff
  messages, and cannot change the guest's phone number through pre-check-in.

**Input limits**

- Stays, quotes and room blocks are capped at 366 nights, in the request schemas and in
  `nightsOf`. Before this, one request could make the server expand millions of nights and
  inventory rows.

**Privacy**

- Anonymizing a guest now also clears:
  - the notes on their orders;
  - their portal notifications;
  - the statutory-discount holder's name and ID on their folios.

**Tenant isolation**

- The system role (used by the worker) could insert any permission into any organization's
  role. It may now add only a template's own permissions, to roles linked to that template.
  That is all the catalog sync needs, and it cannot escalate.

**CI**

- The production deploy takes the commit SHA through the environment instead of the script
  text, requires a full 40-character SHA, and runs only from `main`.

## Left as is, deliberately

- **Append-only records** (order items, the audit log, invoices and receipts) keep what they
  recorded after anonymization. They are records of what happened, and tax documents must
  be kept.
- **HR coverage through past assignments** is kept, as ADR-0014 decided.
  - Consequence: an HR user at a former property keeps full access to the employee's
    file, including write access.
  - If that is too much, the fix is to make ended assignments read-only.
  - This is a product decision.
- **Low-severity items:**
  - The guest CSV import preview reveals whether an email belongs to a guest at another
    property of the organization.
  - Global search limits guests by `reservation.read` instead of also by `guest.read`.
  - Member records show a member's roles at other properties.
  - Maintenance photos, clock selfies and employee document images keep their EXIF data,
    and maintenance photos have no count limit.
  - A booker's data export includes other occupants' charges on the same booking.
  - The web apps send no Content-Security-Policy. The API sends HSTS, and there is no
    `dangerouslySetInnerHTML` beyond the static theme script.
  - The guest portal origin is allowed by CORS on staff routes.
  - Holds call the provider outside the lock. Holds are off with PayMongo (ADR-0032) and
    matter only once they are enabled.

## Needs the repository owner (not code)

- **GitHub:** limit the `staging` and `production` environments to the `main` branch
  (Settings → Environments → Deployment branches), and keep required reviewers on
  production.
  - The AWS deploy role trusts any workflow run that uses the environment.
  - Without the branch rule, a pushed branch with a modified workflow could get the role.

## Consequences

- New tests cover:
  - parallel kiosk PIN guesses (exactly five get through);
  - MFA enrollment with a wrong password;
  - a suspended organization;
  - status changes against roles the actor cannot grant;
  - link re-send revoking sessions;
  - the verification-gated guest routes;
  - over-long quotes and blocks;
  - the cancelled-stay session ending.
- Migration `20261005090000_security_hardening`: the narrowed template-sync policy, plus
  column grants for anonymization.
