# ADR-0012: Front office, folio ledger, housekeeping and night audit

- Status: Accepted, 2026-09-27
- Blueprint: §12.4 (night audit), §12.5 (check-in/out), §15 (billing), §31 (housekeeping)

## Decision

**Check-in / check-out**: the rules live in one service (`FrontOfficeService`), so the
future guest self check-in reuses them.

- Check-in requires all of the following:
  - the reservation is confirmed and the room line is still upcoming;
  - arrival = the property's business date;
  - a room is assigned, and it is clean or inspected, not out of order, and not occupied.
- Check-in creates a `stay` and opens a folio.
- Check-out requires a folio balance of exactly 0 (`409 BALANCE_OUTSTANDING`). It then:
  - closes the folio;
  - marks the room dirty, cancels any stayover task and queues a checkout clean;
  - on an early departure, releases the unused nights and moves the departure date to the
    business date.
- Room moves for in-house guests are refused for now (`409`).

**Folio = append-only ledger**

- Lines are CHARGE (net), TAX (one per tax, linked to its charge), PAYMENT (negative),
  ADJUSTMENT (signed) and REVERSAL (exact negation, linked to the reversed line).
- The database enforces the ledger:
  - a sign CHECK per type;
  - no UPDATE or DELETE on lines and payments (grants plus trigger);
  - postings are refused on closed folios, or in another currency (trigger);
  - the balance is maintained by an `AFTER INSERT` trigger, so it cannot drift from
    `SUM(amount_minor)`;
  - a line can be reversed at most once (unique index).
- **Void** is for same-business-day charges only. After the night audit, corrections are
  **adjustments**, which need `folio.adjust` (sensitive, so MFA).
- **Taxes** are property rules in basis points, inclusive or exclusive, per department. The
  `TaxEngine` splits amounts exactly in integer minor units. Tests check that parts always
  sum to the total, and that negatives mirror positives. The PH demo uses VAT 12% inclusive:
  ₱3,500 = ₱3,125 net + ₱375 VAT.
- **Payments**: cash, card (terminal slip reference), bank transfer, e-wallet or other.
  References that look like card numbers are rejected. Charges, payments and adjustments
  require an `Idempotency-Key`.

**Night audit** (`night_audit.run`, sensitive): one transaction under a lock on the property
row. In order, it:

1. refuses while guests due out are still in house;
2. marks today's unarrived bookings as no-shows and releases them;
3. posts tonight's room charge with tax to every in-house folio;
4. dirties stayover rooms and queues stayover cleaning;
5. records statistics (rooms available/sold, occupancy, room revenue, ADR, RevPAR,
   arrivals, departures, no-shows) in `business_day_closings` (append-only);
6. advances `current_business_date`.

Room charges carry `source_key = room:<line>:<date>`, unique per folio, so a retried audit
cannot charge twice. Running an already-closed date is refused.

**Housekeeping**

- Transitions: DIRTY→CLEANING→CLEAN→INSPECTED, and any→DIRTY.
- `housekeeping.update` covers cleaning. `housekeeping.inspect` covers inspection.
  `housekeeping.assign` gives the full board and task assignment.
- Without `assign`, housekeepers see and change only rooms with a task assigned to them
  ("own records", spec §18).
- Status changes advance the room's open tasks. Every change is recorded in
  `room_status_events`.

**Permissions cache**: the grants cache key now includes a fingerprint of the permission
catalog. Without it, during a rolling deploy, an old instance could cache a grant set that
lacks the new release's permissions under the current grants version, and new instances
would serve it for up to 10 minutes. This was found while verifying this change.

## Not yet built

- Automatic scheduling of the night audit (it is run by a user for now).
- Folio routing and split billing, city ledger / AR, and refunds.
- Invoices and official receipts (needs the BIR decision, D2).
- Room moves for in-house guests, and late checkout / extensions from the front desk.
- Cashier shift reconciliation.
- Payment gateway integration (Phase 6).
