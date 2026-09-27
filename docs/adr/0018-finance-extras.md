# ADR-0018: Foreign cash, statutory discounts, webhook refunds and card holds

- Status: Accepted, 2026-09-28
- Blueprint: §15.1 (folio, taxes), §15.2 (payments, refunds, cashier), §24 (self check-in)
- Builds on ADR-0012 (folio ledger), ADR-0016 (payments and finance)

## Decision

**Foreign cash is converted at the desk, at a rate that is history.**

- `exchange_rates` holds one row per rate change: currency, rate × 10⁶ (`rate_micros`),
  `effective_from`. The table is append-only (trigger), like the ledger. A new rate
  applies from the moment it is set.
- A payment may give `tendered {currency, amountMinor}` instead of `amountMinor`. Only
  cash may be tendered in a foreign currency. The API converts with the rate in force
  (`common/money.ts`: exact bigint arithmetic, both currencies' minor units, half up).
  The payment row keeps the tendered currency, the amount and the rate it used.
  Without a rate the answer is 409 `NO_EXCHANGE_RATE`.
- The folio and the ledger stay in the property currency. The cashier shift also reports
  the foreign notes in the drawer per currency (`foreignCash`), so the count at close
  matches what is physically there.
- Permission `exchange_rate.manage` (finance) sets rates.

**Statutory discounts are configuration, applied when charges are posted.**

- `discount_profiles` belong to a property: code, name, `discount_bps`, exempt tax codes
  and departments. The demo seeds the Philippine senior citizen (RA 9994) and PWD
  (RA 10754) profiles: 20%, VAT-exempt, on room and F&B. Nothing about them is in code.
  `tax.manage` creates and archives profiles.
- `folio.discount` (front office and finance) applies a profile to a folio with the
  holder's name and government ID. The ID is encrypted with the secret box, bound to
  the folio (AAD `folio-discount:{folioId}`). Only the last four digits are ever shown.
- While a folio has a discount, each CHARGE in a covered department is posted like this:
  1. the exempt inclusive taxes are taken out of the price (`applyStatutoryDiscount`);
  2. the charge is posted VAT-exempt at that base, marked "(VAT-exempt)";
  3. the discount follows as an ADJUSTMENT line linked to the charge (`parent_line_id`).

  For example, ₱3,500 incl. 12% VAT → ₱3,125 base → −₱625 → ₱2,500.

- Voids and transfers already move every line hanging off a charge, so the discount
  always goes with its charge.
- The discount applies from then on. Earlier charges are corrected with an adjustment,
  which stays an explicit, audited act.

**Refunds can complete later, by webhook.**

- A provider may answer a refund with PENDING. The refund then keeps its `provider` and
  `provider_ref`. The `refund.succeeded` / `refund.failed` webhook finds it through a new
  lookup-only policy, `by_provider_ref` on `refunds`, the same pattern as payment
  intents. Under a row lock it posts the REFUND line, or marks the refund FAILED.
  Redelivered events are no-ops (webhook inbox), and so are events for a refund no
  longer PENDING.
- If the folio closed in between, the refund is still recorded as succeeded, without a
  line. Reconciliation shows it for finance to adjust.
- Pending refunds count against the refundable amount. The sandbox leaves amounts ending
  in 13 minor units pending, so tests and staging exercise this path.

**Card holds (pre-authorization) gate self check-in.**

- `payment_intents.kind` is PAYMENT or HOLD.
  - A HOLD belongs to a reservation line, because the folio only exists after check-in.
  - Its checkout asks the provider for `capture: MANUAL`.
  - The provider's `payment.authorized` event moves it to the new status AUTHORIZED.
  - No money moves and nothing is posted.
- The property sets the amount: `property_settings` key `payments`, field
  `selfCheckInHoldMinor`, where 0 means none. It is edited with
  `property.settings.manage`.
  - The guest stay shows `cardHold {requiredMinor, currency, authorized}`.
  - Self check-in answers 409 `HOLD_REQUIRED` until a hold of at least that amount is
    authorized.
  - The front desk never needs a hold.
- `POST /guest/holds` reuses an authorized hold, or a still-open pending checkout, under
  an advisory lock per reservation line. A retried tap never places two holds.
- Staff capture (`payment.create`, idempotent) up to the authorized amount onto the
  stay's open folio.
  - The provider is called first.
  - Then, under the intent's row lock, a CARD payment is posted.
  - The hold becomes SUCCEEDED, with `captured_minor` and the folio.
- Releasing marks the hold CANCELLED after the provider releases it.
- Reconciliation reports `STALE_HOLD` for authorized holds:
  - holds older than 7 days, which issuers typically drop;
  - holds whose stay was checked out, cancelled or a no-show.

## Consequences

- The sandbox gateway supports holds ("Authorize" on its hosted page) and asynchronous
  refunds. A real gateway adapter must implement `capture`, `release` and the
  `payment.authorized` event. The gateway choice itself is still open (decision D6).
- `payments`, `exchange_rates` and the ledger stay append-only. Discount columns on
  `folios` are the only new mutable fields, and they are column-granted.
- Statutory rules that differ by country or change by law are handled by editing or
  adding profiles, with no deploy.
