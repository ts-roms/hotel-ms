import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProblemException } from '../../../common/problem.js';
import { invalidSignature, type PaymentProvider, type ProviderEvent } from './providers.js';

export interface PaymongoConfig {
  /** sk_test_… or sk_live_…; HTTP Basic username, empty password. */
  secretKey: string;
  /** The webhook's own secret (whsk_…), shown when the webhook is created. */
  webhookSecret: string;
  /** Payment methods offered on the hosted page, as PayMongo names them. */
  methods: string[];
  /** https://api.paymongo.com/v1 outside tests. */
  apiBase: string;
}

const TOLERANCE_SECONDS = 300;
const TIMEOUT_MS = 15_000;

const EWALLETS = new Set(['gcash', 'paymaya', 'grab_pay', 'shopee_pay']);

/** PayMongo's payment method name → our folio payment method. */
function methodOf(sourceType: unknown): ProviderEvent['method'] {
  if (sourceType === 'card') return 'CARD';
  if (typeof sourceType === 'string' && EWALLETS.has(sourceType)) return 'EWALLET';
  return 'BANK_TRANSFER';
}

export const providerUnavailable = (detail: string) =>
  new ProblemException(502, 'INTERNAL_ERROR', 'Payment provider error', detail);

/** PayMongo answered but said no (e.g. an amount below its minimum): staff can act on it. */
const providerRejected = (detail: string) =>
  new ProblemException(422, 'PAYMENT_PROVIDER_REJECTED', 'Payment provider refused', detail);

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});

/**
 * PayMongo (Philippines) through its hosted Checkout (ADR-0032). Payers choose card, GCash,
 * Maya, etc. on PayMongo's page; we learn the result from `checkout_session.payment.paid`.
 *
 * - Our reference is the checkout session id (`cs_…`). Refunds and captures need PayMongo's
 *   payment or payment intent id, so they read the session first.
 * - Webhooks are signed `Paymongo-Signature: t=…,te=…,li=…`, HMAC-SHA256 over `t.body`
 *   with the webhook secret; `te` for test keys, `li` for live keys. The mode comes from
 *   our key, never from the (unverified) body.
 * - PHP only. Card holds are refused until the authorization event of a manual-capture
 *   checkout is confirmed against PayMongo's test mode.
 */
export class PaymongoProvider implements PaymentProvider {
  readonly code = 'paymongo';
  private readonly live: boolean;

  constructor(
    private readonly config: PaymongoConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.live = config.secretKey.startsWith('sk_live_');
  }

  private async call(method: 'GET' | 'POST', path: string, attributes?: Json): Promise<Json> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.apiBase}${path}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${this.config.secretKey}:`).toString('base64')}`,
          accept: 'application/json',
          ...(attributes ? { 'content-type': 'application/json' } : {}),
        },
        body: attributes ? JSON.stringify({ data: { attributes } }) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw providerUnavailable('PayMongo could not be reached. Try again.');
    }
    const body = obj(await response.json().catch(() => null));
    if (!response.ok) {
      // PayMongo: { errors: [{ code, detail }] }; the detail is safe to show staff.
      const first = obj(Array.isArray(body.errors) ? body.errors[0] : undefined);
      const detail = typeof first.detail === 'string' ? first.detail : `HTTP ${response.status}`;
      // 401/403 are our configuration (wrong key), not something staff can fix.
      const actionable =
        response.status < 500 && response.status !== 401 && response.status !== 403;
      throw actionable
        ? providerRejected(`PayMongo: ${detail}`)
        : providerUnavailable(`PayMongo: ${detail}`);
    }
    return obj(body.data);
  }

  async createCheckout(input: {
    intentId: string;
    capture: 'AUTOMATIC' | 'MANUAL';
    amountMinor: number;
    currency: string;
    description: string;
    returnUrl: string;
  }): Promise<{ reference: string; checkoutUrl: string }> {
    if (input.capture === 'MANUAL') {
      throw new ProblemException(
        409,
        'FEATURE_DISABLED',
        'Card holds are not available online',
        'Take the card hold at the front desk.',
      );
    }
    if (input.currency !== 'PHP') {
      throw new ProblemException(
        409,
        'FEATURE_DISABLED',
        'Online payment is not available in this currency',
        'PayMongo accepts PHP only. Take the payment at the desk.',
      );
    }
    const session = await this.call('POST', '/checkout_sessions', {
      line_items: [
        { name: input.description, amount: input.amountMinor, currency: 'PHP', quantity: 1 },
      ],
      payment_method_types: this.config.methods,
      description: input.description,
      reference_number: input.intentId,
      metadata: { intent_id: input.intentId },
      success_url: input.returnUrl,
      cancel_url: input.returnUrl,
      send_email_receipt: false,
      show_description: true,
      show_line_items: true,
    });
    const url = obj(session.attributes).checkout_url;
    if (typeof session.id !== 'string' || typeof url !== 'string') {
      throw providerUnavailable('PayMongo returned an unexpected checkout session.');
    }
    return { reference: session.id, checkoutUrl: url };
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderEvent | null {
    const header = headers['paymongo-signature'];
    if (typeof header !== 'string') throw invalidSignature();
    const parts = Object.fromEntries(
      header.split(',').map((p) => p.trim().split('=', 2) as [string, string]),
    );
    const timestamp = Number(parts.t);
    if (
      !Number.isInteger(timestamp) ||
      Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS
    ) {
      throw invalidSignature();
    }
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest();
    const actual = Buffer.from((this.live ? parts.li : parts.te) ?? '', 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw invalidSignature();

    let body: Json;
    try {
      body = obj(JSON.parse(rawBody.toString('utf8')));
    } catch {
      throw invalidSignature();
    }
    const event = obj(body.data);
    const attributes = obj(event.attributes);
    if (typeof event.id !== 'string' || typeof attributes.type !== 'string')
      throw invalidSignature();
    const resource = obj(attributes.data);
    const resourceAttributes = obj(resource.attributes);

    switch (attributes.type) {
      case 'checkout_session.payment.paid': {
        if (typeof resource.id !== 'string') return null;
        const payments = (
          Array.isArray(resourceAttributes.payments) ? resourceAttributes.payments : []
        )
          .map((p) => obj(obj(p).attributes))
          .filter((p) => p.status === 'paid');
        if (payments.length === 0) return null;
        return {
          eventId: event.id,
          type: 'payment.succeeded',
          reference: resource.id,
          amountMinor: payments.reduce((sum, p) => sum + Number(p.amount), 0),
          currency: String(payments[0]!.currency),
          method: methodOf(obj(payments[0]!.source).type),
          failureReason: null,
        };
      }
      case 'payment.refund.updated':
      case 'payment.refunded': {
        // Only a refund resource says which refund finished; anything else stays pending
        // and shows in reconciliation.
        if (typeof resource.id !== 'string' || !resource.id.startsWith('ref_')) return null;
        const status = resourceAttributes.status;
        if (status !== 'succeeded' && status !== 'failed') return null;
        return {
          eventId: event.id,
          type: status === 'succeeded' ? 'refund.succeeded' : 'refund.failed',
          reference: resource.id,
          amountMinor: Number(resourceAttributes.amount),
          currency: String(resourceAttributes.currency),
          method: 'CARD',
          failureReason: null,
        };
      }
      default:
        // payment.paid / payment.failed carry no checkout session; a declined attempt lets
        // the payer retry on the same page, and an unpaid checkout expires on our side.
        return null;
    }
  }

  private async session(reference: string): Promise<Json> {
    if (!/^cs_[A-Za-z0-9]+$/.test(reference)) {
      throw providerUnavailable('Not a PayMongo checkout reference.');
    }
    return obj((await this.call('GET', `/checkout_sessions/${reference}`)).attributes);
  }

  async refund(input: {
    paymentReference: string;
    amountMinor: number;
    currency: string;
  }): Promise<{ reference: string; status: 'SUCCEEDED' | 'PENDING' }> {
    const session = await this.session(input.paymentReference);
    const payment = (Array.isArray(session.payments) ? session.payments : [])
      .map(obj)
      .find((p) => obj(p.attributes).status === 'paid');
    if (typeof payment?.id !== 'string') {
      throw providerUnavailable('PayMongo has no paid payment for this checkout.');
    }
    const refund = await this.call('POST', '/refunds', {
      amount: input.amountMinor,
      payment_id: payment.id,
      reason: 'requested_by_customer',
    });
    const status = obj(refund.attributes).status;
    if (typeof refund.id !== 'string' || status === 'failed') {
      throw providerUnavailable('PayMongo refused the refund.');
    }
    return { reference: refund.id, status: status === 'succeeded' ? 'SUCCEEDED' : 'PENDING' };
  }

  private async paymentIntentId(reference: string): Promise<string> {
    const id = obj((await this.session(reference)).payment_intent).id;
    if (typeof id !== 'string') throw providerUnavailable('PayMongo has no payment intent.');
    return id;
  }

  async capture(input: { reference: string; amountMinor: number }): Promise<void> {
    const id = await this.paymentIntentId(input.reference);
    await this.call('POST', `/payment_intents/${id}/capture`, { amount: input.amountMinor });
  }

  async release(input: { reference: string }): Promise<void> {
    const id = await this.paymentIntentId(input.reference);
    await this.call('POST', `/payment_intents/${id}/cancel`);
  }
}
