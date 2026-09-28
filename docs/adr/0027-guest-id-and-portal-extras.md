# ADR-0027: Guest ID review and guest portal extras

- Status: Accepted, 2026-10-01
- Spec: §22 (identification data), §23 (guest portal), §24 (self check-in: identity
  verification, manual review)
- Builds on ADR-0011 (guest portal), ADR-0019 (private file storage), ADR-0024
  (notifications)

## Decision

**Guest ID: uploaded by the guest, reviewed by a person.**

- A verified guest (email code confirmed) uploads a photo or PDF of an ID for their stay,
  before arrival or while in house. Accepted types are JPEG, PNG, WebP and PDF, up to 8 MiB.
  The file's bytes must match its claimed type.
- Files go to private, tenant-scoped storage (`{org}/guest-ids/{id}`). They are served only
  through the API, with `no-store` and a sandbox CSP, and every view is audited.
- Staff need `guest.identity.review`, which is sensitive and so requires two-step
  verification. It is part of the front-office template, so front desk agents and managers
  have it.
- Uploading notifies reviewers in-app. A reviewer approves, or rejects with a reason the
  guest sees; both use If-Match versions. A new upload supersedes a pending or rejected
  one, and the superseded file is deleted at once. After approval, no further uploads are
  accepted.
- The ID is checked by a person, not by software. The system proves nothing about the
  document itself.

**Self check-in rule.** A property can require an approved ID before self check-in
(`guest_portal` setting `requireIdForSelfCheckIn`, off by default). With it on:

- self check-in answers `ID_REQUIRED` when no ID is uploaded;
- it answers `ID_REVIEW_PENDING` while the ID waits for review;
- it runs the front desk's check-in only once the ID is approved.

Staff check-in at the desk is unchanged, because staff see the physical ID.

**Retention.** The daily organization job deletes ID files 30 days after the stay's
departure date. The row stays, marked `purged`, as the record of who approved what.

**Hotel information** (`guest_portal` setting, edited with `property.settings.manage`):

- About text, amenities, services with hours, and house rules, all shown in the portal.
- Wi-Fi details are shown only to verified guests who are in house.
- The Wi-Fi password is masked in the audit log.

**Guest notification feed.** Each stay has a feed, written in the same transaction as the
change it reports:

- a service request acknowledged, done or cancelled;
- a room-service order confirmed, on its way or delivered, or ready for pickup when it is
  not delivered to a room;
- the ID approved or rejected;
- the guest checked out;
- messages the front desk writes from the reservation (`guest_portal.invite`).

The portal shows the unread count and marks the feed read.

**Request checkout.** An in-house, verified guest asks for checkout, with an optional time
and note.

- The request becomes a front-desk service request (category `CHECKOUT`), and staff with
  `stay.check_out` are notified.
- Only one can be open at a time, and the general request form cannot create one.
- Checking the guest out marks the request done and tells the guest. Checkout itself stays
  at the front desk, because the folio must be settled first.

## Consequences

- The feed is read by polling (every minute while the portal is open). Web push to the
  PWA and SMS/email copies of feed items can come later.
- Checks such as OCR, liveness, document authenticity or matching the ID to the booking
  name are left to the reviewer. A vendor integration could add them behind the same
  review step.
- The 30-day retention is fixed. A per-property setting can follow if a jurisdiction needs
  longer (e.g. police guest registers).
