# ADR-0015: F&B: outlets, menus, orders, kitchen display and room charges

- Status: Accepted, 2026-09-27
- Blueprint: §14 (F&B architecture); phase exit criterion "a room-service order appears on
  the guest folio exactly once"

## Decision

**Outlets and menus.**

- An outlet belongs to a property. Types are RESTAURANT, BAR, CAFE and ROOM_SERVICE.
- Each outlet has:
  - `roomService` (it takes guest-portal orders);
  - `allowRoomCharge`;
  - optional property-local opening hours. Hours may wrap midnight. The database enforces
    "both or neither".
- Menu structure: categories → items → modifier groups (min/max selections) → modifiers.
- Prices are integer minor units in the property currency, as charged. They are
  tax-inclusive where the FNB tax rules are inclusive, as with PH VAT.
- `available` is the kitchen's quick "86" toggle, under its own permission
  (`fnb.menu.availability`). Everything else about menus needs `fnb.menu.manage`.
- Items are archived, never deleted, because orders reference them.

**Orders keep a snapshot.**

- Every line stores the item name, unit price and the chosen modifiers with their prices.
- The order stores:
  - the subtotal;
  - taxes added on top (exclusive only);
  - the total;
  - the FNB tax rules in force when it was placed.
- Later menu or tax edits never change an order. The integration test re-prices an item
  after ordering to check this.
- Options are validated against the live menu:
  - unknown modifiers are refused;
  - each group's min/max is enforced;
  - sold-out items return `409 ITEM_UNAVAILABLE`.
- Order numbers are per property: `F-000001`.

**State machine** (`ORDER_TRANSITIONS` in contracts):

- The flow is PENDING → CONFIRMED → PREPARING → READY → (OUT_FOR_DELIVERY →) DELIVERED.
- Guest orders start PENDING. Staff orders start CONFIRMED, because staff took them.
- Only room orders go out for delivery. Anything else is served straight from READY.
- Each move:
  - is guarded by a version predicate (If-Match);
  - writes an append-only `order_events` row with the actor (MEMBER or GUEST);
  - emits `OrderStatusChanged`.
- Cancelling is allowed before PREPARING with `fnb.order.update`. Later it needs
  `fnb.order.cancel_override`.
- Guests may withdraw an order only while it is PENDING.

**Room charges: exactly once.**

- On DELIVERED, a ROOM_CHARGE order is posted to the stay's open folio in the same
  transaction as the status change.
- The posting uses the order's tax snapshot, department FNB and the source key
  `order:{id}`. The folio's unique `(folio_id, source_key)` makes any repeat a no-op.
- The order records the folio line, and `orders_one_folio_line` makes that unique too.
- This is synchronous rather than through an outbox handler. The worker has no folio or
  tax logic, and the source key gives the same exactly-once guarantee without a second
  path. `OrderCharged` is still emitted for other consumers.
- Cancelling a charged order reverses it, once:
  - REVERSAL lines on the same business day;
  - after night audit, a negative ADJUSTMENT keyed `order:{id}:reversal` with the same
    tax rules.
- A room charge needs someone checked in to that room: staff orders are refused for
  vacant rooms. Delivering after check-out is refused, so staff take payment instead.

**Guest room service.**

- Guest ordering requires:
  - the `guest_food_ordering` flag;
  - a verified guest session;
  - an IN_HOUSE stay (the room comes from the stay, never from the request);
  - an open room-service outlet.
- Placing an order requires an `Idempotency-Key`. Keys are now scoped per principal: the
  staff membership, or the guest session. Before this, guest keys would all have shared
  one scope.

**Kitchen display: realtime.**

- `GET /properties/:p/outlets/:o/orders/stream` is a Server-Sent Events stream behind the
  normal staff guards (`fnb.order.read`, property scope).
- Changes are published to Redis after commit, on `t:{org}:fnb:outlet:{id}`, so every API
  instance fans them out to its own streams.
- Messages carry only the order id and status; the board refetches.
- Heartbeats run every 25 s, and the board falls back to a 10 s poll when the stream is
  down.
- SSE over WebSockets: one direction is all the board needs; it passes through the
  Next.js proxy and ALB unchanged, and it works with cookie auth and CSRF-free GETs.

**Roles.**

- New templates:
  - `kitchen`: read and update orders, and the sold-out toggle;
  - `room_service_runner`: read and update orders.
- Front desk can take orders. Managers get everything. Auditors can read orders.
- Existing organizations receive the new templates through `addMissingTemplateRoles`.

## Consequences

- Covered by tests:
  - menus and sold-out;
  - guest menus;
  - pricing with modifiers;
  - option validation;
  - idempotent replay and 422 on a reused key;
  - the order snapshot;
  - the full state machine with version conflicts;
  - folio exactly-once (API and DB);
  - `order_events` append-only;
  - override cancel with reversal;
  - guest cross-access;
  - the feature flag;
  - staff walk-in and vacant-room refusal;
  - the live SSE stream over a real socket, including another tenant's 404.
- Not built yet:
  - kitchen device sessions with PIN (§9.4; the board uses staff logins for now);
  - station routing within a kitchen;
  - charge-on-confirm as a property policy (charges post on delivery only);
  - taking payments for PAY_ON_DELIVERY / PAY_AT_OUTLET orders (Phase 6);
  - POS integration;
  - `daily_outlet_stats`;
  - pushing status to guests (the portal polls every 20 s).
