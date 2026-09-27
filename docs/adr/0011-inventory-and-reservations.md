# ADR-0011: Inventory, rates and reservations

- Status: Accepted, 2026-09-27
- Blueprint: §12 (PMS architecture), §7.4 (integrity), §18 (idempotency)

## Decision

**Model**

- A **reservation** is the booking. It has one or more **reservation rooms** (lines), each
  with its own room type, rate plan, occupant and stay dates. Departure dates are
  exclusive: the guest does not stay that night.
- **Reservation nights** hold the price of each night, snapshotted at booking. A later
  rate change never reprices an existing booking. Modifying a booking's dates, room type
  or rate plan reprices all its nights at current rates.
- **Guests** are organization-level (decision D3). Property-scoped staff see a guest only if
  it was created at, or has a booking at, one of their properties.
- **Room status** has separate dimensions (§12.2): housekeeping and service status are
  stored on the room, with every change in `room_status_events` (append-only). Occupancy is
  derived. "Out of order" is a date-ranged **block**.
- Money is `bigint` minor units in the database and integer minor units in the API, always
  with a currency. The currency comes from the property.

**No overselling, no double assignment**

- `inventory_nights (room type, date)` holds capacity/sold/blocked, with
  `CHECK (sold + blocked <= capacity + overbooking_limit)`. Rows are created on demand
  with capacity = active rooms of the type. Booking takes each night with a conditional
  `UPDATE` after locking the rows with `SELECT … FOR UPDATE`, ordered by (room type, date),
  so concurrent bookings serialize without deadlocks.
- `room_assignments` holds room holds from bookings and blocks, with
  `EXCLUDE USING gist (room_id WITH =, daterange(start, end) WITH &&) WHERE released_at IS NULL`.
  Released holds keep their history.
- Constraint violations that reach the API are mapped to the same problem codes as the
  application checks (`NO_AVAILABILITY`, `ROOM_UNAVAILABLE`), never a 500.
- Tested: 6 concurrent bookings for the last 2 rooms give exactly 2 successes. 5
  concurrent holds on one room give exactly 1.

**Idempotency** (`POST …/reservations` requires `Idempotency-Key`)

- The key is scoped to member and operation. A repeat with the same body replays the stored
  response (`Idempotent-Replayed: true`). A different body returns 422. A concurrent duplicate
  returns 409. Failed requests release the key so the client can retry.

**Confirmation numbers** are `{PROPERTY}-{000001}` from a per-property counter
(`number_sequences`), incremented inside the booking transaction.

**Permissions** added: `room.read/manage`, `rate.read/manage`, `guest.read/update`,
`reservation.read/create/update/cancel`, and a `front_desk` role template. Existing
organizations receive new template permissions through
`propagateTemplatePermissions()`. This runs in the migrate task as the system role, which RLS
limits to reading role ids, inserting role permissions and bumping grants versions.

## Not yet built (PR 2 and later)

Check-in/out, stays and folios, housekeeping workflow, night audit (which will set nightly
room charges and no-shows), group blocks/allocations, overbooking limits per night, and
restrictions (minimum stay, closed to arrival).
