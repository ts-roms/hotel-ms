import { ProblemException } from '../../../common/problem.js';

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

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
export type PaymentProviders = ReadonlyMap<string, PaymentProvider>;
