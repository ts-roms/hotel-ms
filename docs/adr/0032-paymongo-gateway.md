# ADR-0032: PayMongo payment gateway

- Status: Accepted, 2026-09-29
- Spec: blueprint §15.2; decision D6 (payment providers)
- Builds on ADR-0016 (provider port, intents, webhooks, refunds)

## Decision

**PayMongo is the first real gateway.** It covers the Philippine methods guests use (cards,
GCash, Maya, online banking) and is a second `PaymentProvider` next to the sandbox
(`apps/api/src/modules/finance/payments/paymongo.provider.ts`). Nothing else in the
payment flow changed.

**Hosted Checkout (Checkout Sessions API, v1).**

- A payment intent creates a checkout session with one line item, `reference_number` =
  our intent id, and `success_url` = `cancel_url` = the intent's return URL.
- Our provider reference is the session id (`cs_…`); the payer pays on PayMongo's page, so
  PCI scope stays SAQ A.
- Offered methods come from `PAYMONGO_PAYMENT_METHODS` (default `card,gcash,paymaya`);
  each must be enabled on the merchant account.
- PHP only (PayMongo's limit): other folio currencies get `409 FEATURE_DISABLED`.

**Webhooks.** `POST /api/v1/webhooks/payments/paymongo`, registered in the PayMongo
dashboard for `checkout_session.payment.paid` and `payment.refund.updated`.

- Signature: `Paymongo-Signature: t=…,te=…,li=…`, HMAC-SHA256 of `t + "." + raw body` with
  the webhook's secret; 5-minute tolerance. We compare `te` for a test key and `li` for a
  live key: the mode comes from our key, never from the unverified body.
- `checkout_session.payment.paid` → `payment.succeeded` for the session, with the method
  from the paid payment's source (`card` → CARD, e-wallets → EWALLET, the rest →
  BANK_TRANSFER). The amount check of ADR-0016 still applies.
- `payment.refund.updated` with a refund resource (`ref_…`, `succeeded`/`failed`) completes
  a pending refund.
- Any other authentic event (`payment.paid`, `payment.failed`, …) is acknowledged and
  ignored. A declined attempt lets the payer retry on the same page; an unpaid checkout
  expires on our side. The port's `verifyWebhook` may now return `null` for this.

**Refunds, captures, releases.** PayMongo refunds a payment (`pay_…`) and captures a payment
intent (`pi_…`), while we hold the session id; the adapter reads the session first. PayMongo
refunds are normally asynchronous: the refund stays `PENDING` until its webhook, and a stuck
one shows in reconciliation.

**Errors.** PayMongo's own error detail is passed on. When it refuses a request (4xx other
than 401/403, e.g. an amount below its minimum) the API answers
`422 PAYMENT_PROVIDER_REJECTED`, which staff see. An unreachable PayMongo, a 5xx or a
rejected API key is `502` (a configuration or outage problem, shown generically).

**Not yet: card holds.** PayMongo supports manual capture, but its documentation does not
say which webhook a manual-capture checkout sends once the card is authorized.
`createCheckout` refuses `MANUAL` with `409 FEATURE_DISABLED` ("take the card hold at the
front desk") until that is confirmed in PayMongo's test mode. Capture and cancel are
implemented for when it is.

**Configuration.**

- `PAYMENT_PROVIDER=paymongo`, `PAYMONGO_SECRET_KEY` (`sk_test_…`/`sk_live_…`),
  `PAYMONGO_WEBHOOK_SECRET`. The API refuses to start with the provider selected and a key
  missing.
- The provider is registered whenever its keys are set, so webhooks and refunds of earlier
  PayMongo payments keep working if `PAYMENT_PROVIDER` changes.
- `PAYMONGO_API_BASE` exists for tests only; production requires https.
- Terraform: `payment_provider` selects the gateway. With `"paymongo"` it creates an empty
  `<name>/paymongo` secret (values set with `aws secretsmanager put-secret-value`, never in
  state), lets the ECS execution role read it, and injects both keys into the API.

## Consequences

- Tested without credentials against a local fake of PayMongo's API (`apps/api/test/
fake-paymongo.ts`), which signs webhooks exactly as PayMongo does:
  - unit: request shape, error mapping, signature (forged, stale, unsigned, test vs live
    key), event mapping, refund lookup;
  - integration: payment link → checkout → signed webhook → folio payment; duplicate and
    forged webhooks; an ignored event; a PayMongo refusal shown with its reason; refund →
    pending → refund event → folio refund line.
- Before going live: run one payment and one refund with real test keys and a registered
  webhook, and confirm the event payloads match the fake (field paths in the adapter are
  from PayMongo's API reference).
- Still open from ADR-0016: holds (above), foreign-currency payments, BIR accreditation.
