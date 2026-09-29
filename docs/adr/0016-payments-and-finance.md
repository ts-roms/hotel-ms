# ADR-0016: Online payments, refunds, cashier shifts, documents, routing and reports

- Status: Accepted, 2026-09-28
- Blueprint: §15 (billing and payments); decisions D2 (jurisdiction) and D6 (payment
  providers)

## Decision

**Payment provider port.**

- `PaymentProvider` has three operations:
  - `createCheckout` returns a hosted checkout URL and a reference;
  - `verifyWebhook` takes the raw body and headers and returns a normalized event, or
    rejects;
  - `refund`.
- Card data never reaches our servers. Payers pay on the provider's page, so PCI scope
  stays at SAQ A.
- Providers are registered by code. `PAYMENT_PROVIDER` selects the one used for new
  intents. Unset means online payments are off (`409 FEATURE_DISABLED`).

**Sandbox gateway.**

- The only provider in this change is a built-in sandbox that behaves like a
  hosted-checkout gateway:
  - it serves its checkout page at `/api/v1/sandbox-gateway/checkout/:ref` (Pay / Decline);
  - it signs webhooks with HMAC-SHA256 over `timestamp.body`
    (`sandbox-signature: t=…,v1=…`, 5-minute tolerance);
  - verification uses the same path as a real provider's, and the result is delivered
    through the same handler.
- The sandbox is on by default outside production. Production (e.g. staging) needs
  `PAYMENT_SANDBOX_ENABLED=true` and a real `PAYMENT_SANDBOX_SECRET`, or the API refuses
  to start.
- A real adapter (PayMongo, Xendit, Adyen or Stripe, per D6) is a new class plus its
  signature scheme. It needs the provider choice and merchant credentials. PayMongo was
  added in ADR-0032.

**Intents and webhooks.**

- A `payment_intent` holds the folio, amount, provider reference and status. The provider
  call happens outside any database transaction.
- A folio PAYMENT line is posted **only** when a verified `payment.succeeded` arrives,
  inside a transaction that locks the intent.
- The webhook endpoint (`POST /webhooks/payments/:provider`) is marked `@Webhook()`: it is
  public, exempt from the browser Origin check, and authenticated by the signature over
  the raw body (`rawBody: true`).
- Every verified event is stored in `webhook_events` before processing, with
  `UNIQUE (provider, event_id)`:
  - a redelivered event is a no-op (`duplicate`);
  - a failed one is recorded and answered with 500, so the provider retries with its own
    backoff. Blueprint §15.2 put processing in the worker; retries are the provider's job
    here, because the worker has no folio logic.
- Webhooks carry no tenant. The intent is found through a narrow RLS policy
  (`by_provider_ref`, keyed by `app.payment_ref = "provider:reference"`), like the
  guest-token lookups. The tenant context then comes from that row, with
  `actorType = SYSTEM`.
- A success whose amount or currency differs from the intent, or that arrives after the
  folio has closed, is **not** posted. The intent is marked `needsAttention`, and the
  reconciliation report lists it.

**Refunds.**

- Refunds are capped at captured minus earlier refunds (pending and succeeded).
- Concurrent refunds are serialized with a transaction-scoped advisory lock on the
  payment. `payments` is append-only by grant, so `FOR UPDATE` is not available.
- `payment.refund` is a sensitive permission: it needs an MFA-verified session.
- Gateway payments are refunded through the provider. Desk payments are recorded.
- A refund posts a positive REFUND folio line, since money goes back to the payer.
- Refunds need an open folio. Refunds after check-out are a finance process (adjustment
  plus refund), not built here.
- The provider interface allows asynchronous refunds (`PENDING`). Completing them by
  webhook is not implemented, because the current provider refunds synchronously.
  Pending refunds older than an hour show in reconciliation.

**Cashier shifts.**

- Cash taken at the desk requires the cashier's open shift at the property
  (`409 CASHIER_SHIFT_REQUIRED`). Cash refunds come out of the refunder's shift.
- The database allows one open shift per cashier and property.
- Closing a shift:
  - records expected (float + cash in − cash out), counted and variance;
  - can be done only by the shift's owner;
  - is guarded by If-Match.

**Documents.**

- Invoices (`INV-000001`) and receipts (`RCT-000001`, one per payment) are immutable
  snapshots: property, bill-to, lines, tax summary, totals and payment.
- They are append-only by trigger.
- Numbers are gap-free per property and type: the row-locked counter is incremented in
  the issuing transaction, so a failed issue consumes nothing.
- ⚠ They are **not BIR-accredited official receipts** (D2), and the rendered document
  says so. Accreditation (CAS/e-invoicing) needs legal and accounting sign-off, and may
  change numbering and format.

**Accounts, routing and transfers.**

- A company or group account is a folio with a `label` and no stay (city ledger).
- Routing rules send new CHARGE postings of chosen departments from a folio to a target
  folio, for example "the company pays the room". Routing never chains.
- Transfers move existing charges, with their taxes, as a TRANSFER pair linked by
  `transfer_id`:
  - the source side references the charge, so the existing reversed-once index lets a
    charge move once;
  - a moved charge can no longer be voided.
- Revenue is recognized on the original posting only. Transfers only move balances.

**Reports.**

- The daily report covers one business date:
  - revenue by department (net charges, adjustments and reversals without a tax code);
  - taxes by code;
  - payments and refunds by method;
  - outstanding balance on open folios.
- Reconciliation checks:
  - cached folio balances against the ledger;
  - payments without their folio line;
  - unapplied online payments;
  - checkouts that expired without a result;
  - cashier shifts open for more than 24 hours;
  - refunds stuck pending.
- Both need `finance.report.read`.

**Roles.**

- New permissions: `payment.refund` (sensitive), `cashier.shift`, `folio.transfer`,
  `invoice.issue` and `finance.report.read`.
- A new **Group Finance** template.
- Front desk can open shifts and issue documents. Managers get all finance permissions.
  Auditors can read reports.

## Consequences

- Covered by tests:
  - the full hosted-checkout flow (page, form post, redirect, folio);
  - duplicate, stale and forged webhooks;
  - decline;
  - an amount mismatch flagged, not posted;
  - guest self-payment;
  - the refund cap, a concurrent-refund race, the MFA gate, and refund lines;
  - the cashier drawer with a variance;
  - routing;
  - transfer once and no void after transfer;
  - gap-free numbering, one receipt per payment, immutability;
  - the daily report;
  - reconciliation.
- Not built yet:
  - a real gateway adapter (PayMongo since ADR-0032);
  - asynchronous refund completion;
  - foreign-currency cash (tendered currency and rate);
  - pre-authorizations and deposits for self check-in;
  - BIR accreditation;
  - a scheduled nightly reconciliation (run on demand, or add to night audit);
  - PH senior-citizen and PWD discounts in the tax engine.
