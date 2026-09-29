import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ProblemException } from '../../../common/problem.js';
import type { Env } from '../../../config/env.js';

/** A provider event, verified and normalized. */
export interface ProviderEvent {
  eventId: string;
  type:
    | 'payment.succeeded'
    | 'payment.authorized'
    | 'payment.failed'
    | 'refund.succeeded'
    | 'refund.failed';
  /** Checkout reference for payment events, refund reference for refund events. */
  reference: string;
  amountMinor: number;
  currency: string;
  /** How the payer paid (card, e-wallet...), for payment events. */
  method: 'CARD' | 'EWALLET' | 'BANK_TRANSFER';
  failureReason: string | null;
}

/**
 * Online payment gateway adapter (blueprint §15.2). Card data never reaches us: payers
 * pay on the provider's hosted page, and the result arrives as a signed webhook.
 */
export interface PaymentProvider {
  readonly code: string;
  createCheckout(input: {
    intentId: string;
    /** MANUAL = a card hold (pre-authorization), captured or released later. */
    capture: 'AUTOMATIC' | 'MANUAL';
    amountMinor: number;
    currency: string;
    description: string;
    returnUrl: string;
  }): Promise<{ reference: string; checkoutUrl: string }>;
  /**
   * Throws INVALID_SIGNATURE unless the request is authentic and fresh. Null: authentic,
   * but not an event we act on (acknowledged and ignored).
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderEvent | null;
  /** SUCCEEDED when the provider refunds synchronously; PENDING when a webhook follows. */
  refund(input: { paymentReference: string; amountMinor: number; currency: string }): Promise<{
    reference: string;
    status: 'SUCCEEDED' | 'PENDING';
  }>;
  /** Captures (part of) an authorized hold; the rest is released. */
  capture(input: { reference: string; amountMinor: number; currency: string }): Promise<void>;
  /** Releases an authorized hold without capturing. */
  release(input: { reference: string }): Promise<void>;
}

export const invalidSignature = () =>
  new ProblemException(
    400,
    'INVALID_SIGNATURE',
    'Invalid signature',
    'The webhook signature does not verify.',
  );

const TOLERANCE_SECONDS = 300;

/**
 * Built-in sandbox gateway for development, tests and staging. It behaves like a real
 * hosted-checkout provider: a checkout URL (served by this API under /sandbox-gateway),
 * and results delivered as HMAC-SHA256 signed webhooks with timestamps
 * (`sandbox-signature: t=<unix>,v1=<hex>`), verified exactly like a real provider's.
 */
export class SandboxProvider implements PaymentProvider {
  readonly code = 'sandbox';

  constructor(private readonly env: Pick<Env, 'API_PUBLIC_ORIGIN' | 'PAYMENT_SANDBOX_SECRET'>) {}

  async createCheckout(): Promise<{ reference: string; checkoutUrl: string }> {
    const reference = `sbx_${randomBytes(12).toString('hex')}`;
    return {
      reference,
      checkoutUrl: `${this.env.API_PUBLIC_ORIGIN}/api/v1/sandbox-gateway/checkout/${reference}`,
    };
  }

  sign(rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const mac = createHmac('sha256', this.env.PAYMENT_SANDBOX_SECRET)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    return `t=${timestamp},v1=${mac}`;
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderEvent {
    const header = headers['sandbox-signature'];
    if (typeof header !== 'string') throw invalidSignature();
    const parts = Object.fromEntries(
      header.split(',').map((p) => p.split('=', 2) as [string, string]),
    );
    const timestamp = Number(parts.t);
    if (
      !Number.isInteger(timestamp) ||
      Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS
    ) {
      throw invalidSignature();
    }
    const expected = Buffer.from(
      this.sign(rawBody.toString('utf8'), timestamp).split('v1=')[1]!,
      'hex',
    );
    const actual = Buffer.from(parts.v1 ?? '', 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw invalidSignature();

    let body: {
      id?: unknown;
      type?: unknown;
      data?: {
        reference?: unknown;
        amountMinor?: unknown;
        currency?: unknown;
        method?: unknown;
        failureReason?: unknown;
      };
    };
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw invalidSignature();
    }
    const types = [
      'payment.succeeded',
      'payment.authorized',
      'payment.failed',
      'refund.succeeded',
      'refund.failed',
    ];
    const methods = ['CARD', 'EWALLET', 'BANK_TRANSFER'];
    const data = body.data ?? {};
    if (
      typeof body.id !== 'string' ||
      !types.includes(String(body.type)) ||
      typeof data.reference !== 'string' ||
      !Number.isInteger(data.amountMinor) ||
      typeof data.currency !== 'string'
    ) {
      throw invalidSignature();
    }
    return {
      eventId: body.id,
      type: body.type as ProviderEvent['type'],
      reference: data.reference,
      amountMinor: data.amountMinor as number,
      currency: data.currency,
      method: methods.includes(String(data.method))
        ? (data.method as ProviderEvent['method'])
        : 'CARD',
      failureReason: typeof data.failureReason === 'string' ? data.failureReason : null,
    };
  }

  /**
   * Refunds complete at once, except "magic" amounts ending in 13 minor units, which stay
   * pending until a refund webhook arrives (like test amounts at real gateways).
   */
  async refund(input: {
    amountMinor: number;
  }): Promise<{ reference: string; status: 'SUCCEEDED' | 'PENDING' }> {
    return {
      reference: `sbx_re_${randomBytes(10).toString('hex')}`,
      status: input.amountMinor % 100 === 13 ? 'PENDING' : 'SUCCEEDED',
    };
  }

  async capture(): Promise<void> {
    // The sandbox captures authorized holds immediately.
  }

  async release(): Promise<void> {
    // Nothing is held in the sandbox beyond our own record.
  }

  /** Builds a signed event, as the sandbox's hosted page does after the payer decides. */
  event(input: {
    type: ProviderEvent['type'];
    reference: string;
    amountMinor: number;
    currency: string;
    method?: ProviderEvent['method'];
    failureReason?: string;
  }): { rawBody: string; headers: Record<string, string> } {
    const rawBody = JSON.stringify({
      id: `evt_${randomBytes(12).toString('hex')}`,
      type: input.type,
      data: {
        reference: input.reference,
        amountMinor: input.amountMinor,
        currency: input.currency,
        method: input.method ?? 'CARD',
        ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      },
    });
    return {
      rawBody,
      headers: { 'content-type': 'application/json', 'sandbox-signature': this.sign(rawBody) },
    };
  }
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
export type PaymentProviders = ReadonlyMap<string, PaymentProvider>;
