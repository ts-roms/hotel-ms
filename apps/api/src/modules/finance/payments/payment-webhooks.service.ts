import { Injectable } from '@nestjs/common';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { isUniqueViolation } from '../../../common/db-errors.js';
import { toMinor } from '../../../common/money.js';
import { Problems } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { GuestMessagesService } from '../../notifications/guest-messages.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { FolioService } from '../folio/folio.service.js';
import type { IntentRow } from './payment-dto.js';
import { PaymentsService } from './payments.service.js';
import type { PaymentProvider, ProviderEvent } from './providers.js';

/**
 * Provider webhooks (blueprint §15.2, ADR-0018): every event is verified and stored first,
 * a redelivered event is a no-op, and the tenant comes from the intent or refund the
 * verified reference resolves to.
 */
@Injectable()
export class PaymentWebhooksService {
  constructor(
    private readonly db: TenantDb,
    private readonly payments: PaymentsService,
    private readonly folios: FolioService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
    private readonly guestMessages: GuestMessagesService,
  ) {}

  /**
   * Verifies, stores and applies one provider event. Duplicates return 'duplicate'.
   * Processing errors are recorded and rethrown, so the provider retries later.
   */
  async handleWebhook(
    providerCode: string,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<'processed' | 'ignored' | 'duplicate'> {
    const provider = this.payments.providerFor(providerCode);
    if (!provider) throw Problems.notFound('Payment provider');
    const event = provider.verifyWebhook(rawBody, headers);
    if (!event) return 'ignored';
    const paymentRef = `${provider.code}:${event.reference}`;

    const inbox = await this.db.runWithPaymentRef(paymentRef, async (tx) => {
      try {
        return await tx.webhookEvent.create({
          data: {
            provider: provider.code,
            eventId: event.eventId,
            eventType: event.type,
            signatureValid: true,
            payload: JSON.parse(rawBody.toString('utf8')) as Prisma.InputJsonValue,
            attempts: 1,
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return null;
      }
    });
    let eventRowId: string;
    if (inbox) {
      eventRowId = inbox.id;
    } else {
      const existing = await this.db.runWithPaymentRef(paymentRef, (tx) =>
        tx.webhookEvent.findUniqueOrThrow({
          where: { provider_eventId: { provider: provider.code, eventId: event.eventId } },
        }),
      );
      if (existing.status === 'PROCESSED' || existing.status === 'IGNORED') return 'duplicate';
      eventRowId = existing.id;
      await this.db.runWithPaymentRef(paymentRef, (tx) =>
        tx.webhookEvent.update({ where: { id: eventRowId }, data: { attempts: { increment: 1 } } }),
      );
    }

    try {
      const outcome = await this.apply(provider, event);
      await this.db.runWithPaymentRef(paymentRef, (tx) =>
        tx.webhookEvent.update({
          where: { id: eventRowId },
          data: {
            status: outcome === 'processed' ? 'PROCESSED' : 'IGNORED',
            processedAt: new Date(),
            lastError: null,
          },
        }),
      );
      return outcome;
    } catch (error) {
      await this.db.runWithPaymentRef(paymentRef, (tx) =>
        tx.webhookEvent.update({
          where: { id: eventRowId },
          data: {
            status: 'FAILED',
            lastError: error instanceof Error ? error.message.slice(0, 500) : 'error',
          },
        }),
      );
      throw error;
    }
  }

  private async apply(
    provider: PaymentProvider,
    event: ProviderEvent,
  ): Promise<'processed' | 'ignored'> {
    if (event.type === 'refund.succeeded' || event.type === 'refund.failed') {
      return this.applyRefundEvent(provider, event);
    }
    const intent = await this.payments.findByReference(provider.code, event.reference);
    if (!intent) return 'ignored';

    // The tenant comes from the intent the verified reference resolved to.
    this.cls.set('organizationId', intent.organizationId);
    this.cls.set('propertyId', intent.propertyId);
    this.cls.set('system', true);

    let received: string | null = null;
    const outcome = await this.db.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payment_intents WHERE id = ${intent.id}::uuid FOR UPDATE`;
      const current = await tx.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
      if (current.kind === 'HOLD') return this.applyHoldEvent(tx, current, event);
      if (event.type === 'payment.authorized') return 'ignored';
      if (current.status === 'SUCCEEDED' || current.status === 'FAILED') return 'ignored';

      if (event.type === 'payment.failed') {
        await tx.paymentIntent.update({
          where: { id: current.id },
          data: { status: 'FAILED', failureReason: event.failureReason ?? 'Declined' },
        });
        await this.outbox.enqueue(
          tx,
          'PaymentFailed',
          {
            paymentIntentId: current.id,
            folioId: current.folioId,
            reason: event.failureReason ?? 'Declined',
          },
          { propertyId: current.propertyId },
        );
        return 'processed';
      }

      // payment.succeeded: money was taken, even if the intent had expired meanwhile.
      if (
        BigInt(event.amountMinor) !== current.amountMinor ||
        event.currency !== current.currency
      ) {
        await tx.paymentIntent.update({
          where: { id: current.id },
          data: {
            status: 'SUCCEEDED',
            needsAttention: true,
            failureReason: `Provider reported ${event.amountMinor} ${event.currency}; expected ${toMinor(current.amountMinor)} ${current.currency}.`,
          },
        });
        return 'processed';
      }
      const folio = await tx.folio.findUniqueOrThrow({ where: { id: current.folioId! } });
      let paymentId: string | null = null;
      if (folio.status === 'OPEN') {
        paymentId = await this.folios.recordPaymentInTx(tx, folio.id, {
          method: event.method,
          amountMinor: event.amountMinor,
          reference: event.reference,
          provider: provider.code,
          intentId: current.id,
        });
      }
      await tx.paymentIntent.update({
        where: { id: current.id },
        data: {
          status: 'SUCCEEDED',
          paymentId,
          needsAttention: paymentId === null,
          failureReason:
            paymentId === null ? 'The folio was closed; apply this payment manually.' : null,
        },
      });
      await this.outbox.enqueue(
        tx,
        'PaymentSucceeded',
        {
          paymentIntentId: current.id,
          paymentId,
          folioId: folio.id,
          amountMinor: event.amountMinor,
        },
        { propertyId: current.propertyId },
      );
      received = paymentId;
      return 'processed' as const;
    });
    if (received) await this.guestMessages.paymentReceived(received);
    return outcome;
  }

  /** A hold only moves PENDING → AUTHORIZED (or FAILED); capture and release are ours. */
  private async applyHoldEvent(
    tx: Tx,
    current: IntentRow,
    event: ProviderEvent,
  ): Promise<'processed' | 'ignored'> {
    if (current.status !== 'PENDING') return 'ignored';
    if (event.type === 'payment.failed') {
      await tx.paymentIntent.update({
        where: { id: current.id },
        data: { status: 'FAILED', failureReason: event.failureReason ?? 'Declined' },
      });
      await this.outbox.enqueue(
        tx,
        'PaymentFailed',
        { paymentIntentId: current.id, folioId: null, reason: event.failureReason ?? 'Declined' },
        { propertyId: current.propertyId },
      );
      return 'processed';
    }
    if (event.type !== 'payment.authorized') return 'ignored';
    if (BigInt(event.amountMinor) !== current.amountMinor || event.currency !== current.currency) {
      await tx.paymentIntent.update({
        where: { id: current.id },
        data: {
          status: 'FAILED',
          needsAttention: true,
          failureReason: `Provider authorized ${event.amountMinor} ${event.currency}; expected ${toMinor(current.amountMinor)} ${current.currency}.`,
        },
      });
      return 'processed';
    }
    await tx.paymentIntent.update({
      where: { id: current.id },
      data: { status: 'AUTHORIZED' },
    });
    await this.outbox.enqueue(
      tx,
      'HoldAuthorized',
      {
        paymentIntentId: current.id,
        reservationRoomId: current.reservationRoomId!,
        amountMinor: event.amountMinor,
      },
      { propertyId: current.propertyId },
    );
    return 'processed';
  }

  /** Completes a refund the provider left pending (ADR-0018). */
  private async applyRefundEvent(
    provider: PaymentProvider,
    event: ProviderEvent,
  ): Promise<'processed' | 'ignored'> {
    const refund = await this.db.runWithPaymentRef(`${provider.code}:${event.reference}`, (tx) =>
      tx.refund.findFirst({ where: { provider: provider.code, providerRef: event.reference } }),
    );
    if (!refund) return 'ignored';

    this.cls.set('organizationId', refund.organizationId);
    this.cls.set('propertyId', refund.propertyId);
    this.cls.set('system', true);

    return this.db.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${refund.id}::uuid FOR UPDATE`;
      const current = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
      if (current.status !== 'PENDING') return 'ignored';
      const failed = event.type === 'refund.failed';
      if (failed) {
        await tx.refund.update({
          where: { id: current.id },
          data: { status: 'FAILED', completedAt: new Date() },
        });
      } else {
        const folio = await tx.folio.findUniqueOrThrow({ where: { id: current.folioId } });
        // The money went back either way; a closed folio is left for finance to adjust.
        const lineId =
          folio.status === 'OPEN'
            ? await this.folios.postRefundLineInTx(tx, folio.id, {
                amountMinor: current.amountMinor,
                description: 'Refund (online)',
                reason: current.reason,
              })
            : null;
        await tx.refund.update({
          where: { id: current.id },
          data: { status: 'SUCCEEDED', folioLineId: lineId, completedAt: new Date() },
        });
      }
      await this.audit.record(tx, {
        action: failed ? 'payment.refund_failed' : 'payment.refund_completed',
        entityType: 'payment',
        entityId: current.paymentId,
        propertyId: current.propertyId,
        after: { refundId: current.id },
      });
      await this.outbox.enqueue(
        tx,
        'RefundIssued',
        {
          refundId: current.id,
          paymentId: current.paymentId,
          amountMinor: toMinor(current.amountMinor),
          status: failed ? 'FAILED' : 'SUCCEEDED',
        },
        { propertyId: current.propertyId },
      );
      return 'processed';
    });
  }
}
