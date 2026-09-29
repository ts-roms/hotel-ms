import type { PaymentIntent, Refund } from '@hotel/contracts';
import type { Prisma } from '@hotel/database';
import { toMinor } from '../../../common/money.js';
import { ProblemException } from '../../../common/problem.js';

/** How long a hosted checkout stays open. */
export const INTENT_TTL_MS = 60 * 60_000;

export const notConfigured = () =>
  new ProblemException(
    409,
    'FEATURE_DISABLED',
    'Online payments are not set up',
    'Take the payment at the desk.',
  );

export type IntentRow = Prisma.PaymentIntentGetPayload<object>;

export function toIntentDto(i: IntentRow): PaymentIntent {
  return {
    id: i.id,
    kind: i.kind === 'HOLD' ? 'HOLD' : 'PAYMENT',
    folioId: i.folioId,
    reservationRoomId: i.reservationRoomId,
    capturedMinor: toMinor(i.capturedMinor),
    provider: i.provider,
    amountMinor: toMinor(i.amountMinor),
    currency: i.currency,
    status: i.status,
    checkoutUrl: i.status === 'PENDING' ? i.checkoutUrl : null,
    paymentId: i.paymentId,
    needsAttention: i.needsAttention,
    failureReason: i.failureReason,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
}

export function toRefundDto(
  r: Prisma.RefundGetPayload<{ include: { payment: { select: { method: true } } } }>,
): Refund {
  return {
    id: r.id,
    paymentId: r.paymentId,
    amountMinor: toMinor(r.amountMinor),
    method: r.payment.method,
    status: r.status,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
  };
}
