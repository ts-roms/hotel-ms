# ADR-0030: Data requests, CSV import and images

- Status: Accepted, 2026-10-04
- Spec: §45 (data privacy), §74 (import and export), §16 and §27 (hotel and menu images)
- Builds on ADR-0019 (private files), ADR-0021 (retention), ADR-0027 (guest IDs)

## Decision

**Data requests.** `privacy.manage` is sensitive (two-step verification) and held at
organization scope; organization administrators have it.

- **Export.** `GET /guests/:id/export` and `GET /employees/:id/export` return everything the
  organization holds about the person as a JSON download:
  - guests: profile, stays, folios and payments, requests, orders, portal messages, ID
    review records, and profile history;
  - employees: profile and personal details, assignments, shifts, attendance, leave,
    documents, trainings, reviews and pay.
  - Every export is audited.
- **Anonymization.**
  - **Guests**, once they have no upcoming or current stay: name becomes "Anonymized Guest";
    email, phone, country and notes are cleared; the profile is archived; booking special
    requests and notes and service request texts are cleared; ID files are deleted; portal
    sessions and links end.
  - **Employees**, only after they have left: name becomes "Former employee <number>";
    personal details and emergency contact are cleared; the login is unlinked; documents
    and selfies are deleted.
- **What is kept.** What the law makes the hotel keep stays, now pointing at a record that
  names nobody:
  - folios, payments, invoices and receipts (tax);
  - attendance, pay and reviews (labor);
  - the audit log.
    The audit entry records the reason and what was done, never the personal data.

**CSV import with preview.** Two kinds: guests (`guest.update`) and rooms (`room.manage`), at
one property.

- **Preview.** The body is the CSV (RFC 4180, UTF-8, Excel's byte-order mark accepted), at
  most 2 MiB and 5,000 rows. Every row is checked for required columns, types and formats,
  duplicates (against the database and earlier rows), and references (room type codes at
  that property). The preview writes nothing.
- **Commit.** Committing is allowed only when no row has an error. The preview returns a
  one-time token valid for 30 minutes, bound to the user, the property and the kind.
  Committing it creates exactly the previewed rows in one transaction and skips duplicates,
  including ones created since the preview.
- **Why a token.** The server keeps the validated plan (in Redis), so the committed data is
  exactly what was reviewed, not a re-upload.

**Images.**

- **Upload.** JPEG, PNG or WebP, up to 8 MiB. The bytes must match the type. Decoding has a
  pixel limit.
- **Processing.** Every image is re-encoded to WebP, turned upright, and scaled to fit 1600 px.
  Re-encoding removes EXIF (GPS location, camera serials) and anything appended to the file.
- **Hotel photos.** Up to 20 per property, with captions and an order, managed with
  `property.settings.manage` and shown in the guest portal.
- **Menu photos.** One per menu item (`fnb.menu.manage`), shown in room service.
- **Serving.** Files are in tenant-scoped storage, served only through the API: to staff of
  the property, or to guests of that property. Responses carry `private` caching with an ETag
  (the image hash), so they are never public URLs.

## Consequences

- **Import scope.** Only guests and rooms are importable for now. Employees (assignments,
  personal data) and rates need their own validation and are not built.
- **Guest texts.** Anonymization does not rewrite free text staff wrote elsewhere (maintenance
  notes, order notes); those rarely name guests. The export shows it all for review.
- **Images at scale.** They are served by the API rather than a CDN, which suits the portal's
  scale. A CDN with signed URLs would be the next step.
