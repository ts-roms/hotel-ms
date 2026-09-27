# ADR-0021: Employee document lifecycle — unfinished uploads and retention

- Status: Accepted, 2026-09-29
- Builds on ADR-0019 (employee documents), ADR-0017 (scheduled tenant jobs)
- Closes the two follow-ups ADR-0019 left open

## Decision

**An upload leaves a trace before it touches storage.**

- ADR-0019 wrote the object first, then the row. A crash in between left an object nothing
  pointed to, and the API role may not list the bucket to find it.
- The order is now:
  1. insert the row with `stored_at` null (pending);
  2. write the object;
  3. set `stored_at`, audit, publish the event.
- A failure after step 1 removes both at once, best effort.
- Pending rows are invisible to every read. A new daily job removes those older than an
  hour, with their object if one exists. No bucket listing is needed, so the API role
  keeps its narrow S3 permissions.
- Stored documents are still never removed:
  - the runtime role may now `DELETE` rows, but a trigger refuses any row with `stored_at`
    set;
  - a check makes a deleted row always a stored one.

**Retention rules per category.**

- An organization setting (`documentRetention`) sets, per document category, how many
  months after the employee's termination date the document is deleted. Empty means kept
  until someone deletes it.
- Setting the rules needs `employee.documents` at organization scope (sensitive, so MFA).
  HR with property-scoped grants can read them but not change them.
- The date is the termination date plus N months, clamped to the month's last day. Every
  document shows it as `purgeOn` once the employee is terminated, so HR sees in advance
  what will go.
- The daily job soft-deletes due documents:
  - `deletion_reason = RETENTION`, no `deleted_by`, and an `employee.document_expired`
    audit entry by SYSTEM;
  - then it removes the files.
- Deletions by people are now `deletion_reason = USER` with `deleted_by`. A check ties the
  three columns together.

**Scheduling.** The worker plans `organization.daily-documents` once per organization and
local date, after 03:00 in the organization's time zone. The job id is
`documents:{organization}:{date}`. The API runs it like the other tenant jobs (sweep
first, then retention), in batches of 500 a day.

## Consequences

- A termination date entered by mistake starts retention. The dates are visible on every
  document, and rules usually count in years, so there is time to correct it.
  Rehiring means clearing the termination.
- No legal-hold flag yet. Until one exists, holding a document back means setting its
  category to "keep".
