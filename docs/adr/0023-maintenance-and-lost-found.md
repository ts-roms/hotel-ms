# ADR-0023: Maintenance requests and lost & found

- Status: Accepted, 2026-09-29
- Spec: §31 (housekeeping: lost & found, maintenance reporting), §32 (maintenance), §70
  ("a room under maintenance cannot be sold")
- Builds on ADR-0011 (inventory and out-of-order blocks), ADR-0019 (object storage)

## Decision

**A maintenance request is a small workflow with an append-only history.**

- A request concerns a room or another place (`location`, e.g. "Lobby elevator"). It has:
  - a category and a priority (low, normal, high, urgent);
  - a title and a description;
  - who reported it, and optionally the guest service request it came from.
- It is numbered per property: `MR-00001`, from the same counters as folios and orders.
- Statuses: OPEN → ASSIGNED → IN_PROGRESS ⇄ ON_HOLD → DONE, and CANCELLED from any
  open status.
  - Holding, completing and cancelling need a note. The completion note is the
    resolution.
  - Every step is a row in `maintenance_updates` (append-only trigger), shown as the
    request's history, and audited.
- Steps use optimistic concurrency (`If-Match`), so two people cannot act on a stale
  request. Database checks keep the columns coherent:
  - closed requests have a completion time;
  - DONE has a resolution;
  - work beyond OPEN has an assignee.

**Permissions** (property-scoped):

| Permission           | Allows                                                                               | Given to                                          |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `maintenance.read`   | See the requests                                                                     | Front office, housekeeping, technicians, managers |
| `maintenance.report` | File requests and add photos                                                         | Front office, housekeeping, technicians, managers |
| `maintenance.work`   | Start, hold, complete and add notes. Non-managers only on requests assigned to them. | New _Maintenance Technician_ template             |
| `maintenance.manage` | Assign, reprioritize, cancel, take rooms out of order                                | New _Maintenance Supervisor_ template; managers   |

**Rooms under maintenance are off sale, through the existing out-of-order blocks.**

- With `maintenance.manage`, a request on a room can take it out of order for a date
  range. This creates the same block the rooms screen creates (ADR-0011): one unit of
  inventory per night is taken, and the exclusion constraint keeps the room from being
  assigned.
  - It fails cleanly if the room is booked, or the type is sold out, for those dates.
  - The block is created first. If the request then fails, the block is released.
- Completing or cancelling the request releases the block, so the room comes back to sale
  from today on. Past nights stay counted as they happened.
- The room's separate "out of service" status is unchanged by this. It is still not
  enforced at assignment, which is a known gap outside this change.

**Photos** of the problem are stored like the other uploads:

- in object storage under `{organization}/maintenance-photos/{id}`;
- JPEG/PNG/WebP up to 8 MiB, checked by magic bytes;
- streamed back with a sandbox CSP.

Unlike selfies they are operational records, not personal data, so they have no
retention period.

**A guest's "something is broken"** request can be sent to maintenance from the service
requests board. That creates a linked maintenance request for the guest's room.

**Lost & found** (`lost_found_items`):

- Items are logged with where they were found (optionally a room), where they are stored,
  and a category (valuables, documents, electronics, clothing, other). They are numbered
  `LF-00001`.
- A held item is closed as RETURNED (to whom, and how ownership was checked) or DISPOSED
  (how). A check ties the status to the closing note and time.
- Housekeeping and technicians log items (`lost_found.log`). Front office and supervisors
  close them (`lost_found.manage`).
- Days held are shown, to support a disposal policy. There is no automatic disposal.

## Consequences

- Preventive (scheduled) maintenance and equipment registers are not modelled yet. A
  request's `location` is free text until assets exist.
- Maintenance events (`MaintenanceRequested`, `MaintenanceStatusChanged`) go through the
  outbox. Notifications to technicians come with the notification center.
