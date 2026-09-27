# ADR-0022: Time clock with Employee ID and selfie

- Status: Accepted, 2026-09-29
- Blueprint: §13.2 (attendance)
- Builds on ADR-0020 (shared devices), ADR-0019/0021 (object storage and its lifecycle)

## Context

Staff clock in and out at the staff entrance, most of them without a personal login.
Punching by Employee ID alone invites buddy punching: anyone can type a colleague's ID.
A photo taken at the moment of the punch makes that visible to HR, without biometric
matching.

## Decision

**A time clock is a shared device of kind `TIME_CLOCK`.**

- It is paired exactly like a kitchen tablet (ADR-0020): a manager with `device.manage`
  registers it and pairs it with a one-time code.
- It carries no permissions, and nobody signs in on it. A database check allows only an
  empty permission list for this kind.
- `/kiosk` shows the clock screen when the device is a time clock.

**A punch is the Employee ID plus a selfie, taken at that moment.**

- `POST /kiosk/clock?employeeNo=…&type=IN|OUT|BREAK_START|BREAK_END`:
  - the body is the camera frame (JPEG/PNG/WebP, at most 2 MiB, checked by magic bytes);
  - it needs the device cookie and the device CSRF token.
- Employee IDs match case-insensitively. The employee must be active and assigned to the
  device's property today.
- The punch goes through the same sequence rules as the web punch (`punchInTx`: row lock
  per employee, IN → BREAK → OUT). It is recorded with source `KIOSK`, and audited as
  SYSTEM with the device id.
- Rate limit: 60 punches per 5 minutes per device. That covers a shift change at the
  door, but not trying IDs at will.
- The shared screen answers with the first name only, and never shows the photo back.
- Order of writes: the photo object first, then the punch and its `attendance_photos`
  row in one transaction. If the punch is refused (for example "not clocked in"), the
  object is deleted.

**Photos are personal data with a short life.**

- `attendance_photos` sits beside the append-only punches. It stores:
  - the storage key and the SHA-256;
  - the device;
  - `deleted_at`, the one mutable column.
- The daily housekeeping job (ADR-0021) deletes photos older than **90 days**. The punches
  themselves stay.
- In S3, photo objects are tagged `retention=attendance-photo`, and a lifecycle rule
  expires them after 100 days. That backstop also removes any object a crash left
  without a punch, without listing the bucket.
- Managers with `attendance.read` at the property can review them:
  - `GET …/attendance/photos?from&to` lists punches with photos;
  - `GET …/attendance/photos/:punchId` streams one photo, with no-store and a sandbox
    CSP. Every view is audited, so the attendance page loads a photo only on request.

## Consequences

- The photo is evidence for a person to look at. There is no face matching, and no
  biometric template is ever created.
- Amended 2026-09-29: the web punch needs a selfie too, so every punch has one.
  - `POST …/attendance/punches?type=…` takes the camera frame as its body, with the same
    checks, storage, review and 90-day deletion as the time clock. The old JSON punch is
    refused (415).
  - It is recorded with source `WEB` and audited as `attendance.web_punch`.
  - The My time page opens the front camera when a punch button is pressed, and the stream
    stops as soon as the punch is sent or cancelled.
- The 90-day period is a constant for now. Making it an organization setting is a small
  follow-up if HR policy differs by country.
