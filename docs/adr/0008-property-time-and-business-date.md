# ADR-0008: Property time zone, currency and business date

- Status: Accepted, 2026-09-27
- Blueprint: §12.4, §52, §53

## Decision

- Each property stores an IANA `timezone`, an ISO 4217 `currency`, a `locale` and a
  `current_business_date` (`date`). Instants are `timestamptz` (UTC).
- Wall-clock policy times (check-in/out) are stored as `HH:mm` and interpreted in the
  property's time zone.
- `current_business_date` starts at "today in the property tz" and is **only** advanced by the
  night audit (Phase 2). It is not the calendar date.
- Time zone and currency cannot be changed through the ordinary property update. That needs a
  dedicated, audited procedure once transactions exist.
