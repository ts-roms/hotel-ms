import { Injectable } from '@nestjs/common';
import type { Refund } from '@hotel/contracts';
import type { Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { toMinor } from '../../../common/money.js';
import { ProblemException, Problems, invalidState } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { FolioService } from '../folio/folio.service.js';
import { toRefundDto } from './payment-dto.js';
import { PaymentsService } from './payments.service.js';

/**
 * Refunds (blueprint §15.2, ADR-0018, ADR-0033): gateway payments are refunded through
 * their provider, desk payments are recorded. An unknown provider outcome stays PENDING.
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly db: TenantDb,
    private readonly payments: PaymentsService,
    private readonly folios: FolioService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /**
   * Refunds up to what was captured minus earlier refunds, under a row lock on the payment
   * (§15.2). Gateway payments are refunded through the provider; desk payments are
   * recorded (cash from the cashier's open shift).
   */
  async refund(
    propertyId: string,
    paymentId: string,
    amountMinor: number,
    reason: string,
  ): Promise<Refund> {
    const organizationId = this.cls.get('organizationId')!;
    const include = { payment: { select: { method: true } } } as const;
    const created = await this.db.run(async (tx) => {
      // payments are append-only (no UPDATE grant, so no FOR UPDATE): an advisory lock
      // serializes refunds of one payment instead.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`refund:${paymentId}`}, 0))`;
      const payment = await tx.payment.findFirst({ where: { id: paymentId, propertyId } });
      if (!payment) throw Problems.notFound('Payment');
      const refunded = await tx.refund.aggregate({
        where: { paymentId, status: { not: 'FAILED' } },
        _sum: { amountMinor: true },
      });
      const remaining = payment.amountMinor - (refunded._sum.amountMinor ?? 0n);
      if (BigInt(amountMinor) > remaining) {
        throw new ProblemException(
          409,
          'REFUND_EXCEEDS_PAYMENT',
          'Refund too large',
          `At most ${toMinor(remaining)} can still be refunded on this payment.`,
        );
      }
      const folio = await tx.folio.findUniqueOrThrow({ where: { id: payment.folioId } });
      if (folio.status !== 'OPEN')
        throw invalidState('The folio is closed. Refunds after check-out are handled by finance.');
      let cashierShiftId: string | null = null;
      if (payment.method === 'CASH' && !payment.provider) {
        const shift = await this.folios.openShiftInTx(tx);
        if (!shift) {
          throw new ProblemException(
            409,
            'CASHIER_SHIFT_REQUIRED',
            'Open a cashier shift',
            'Cash refunds come out of your cashier shift.',
          );
        }
        cashierShiftId = shift.id;
      }
      const viaProvider = payment.provider !== null;
      const refund = await tx.refund.create({
        data: {
          organizationId,
          propertyId,
          paymentId,
          folioId: folio.id,
          amountMinor: BigInt(amountMinor),
          reason,
          status: viaProvider ? 'PENDING' : 'SUCCEEDED',
          provider: payment.provider,
          cashierShiftId,
          createdBy: this.cls.get('identityId') ?? null,
          completedAt: viaProvider ? null : new Date(),
        },
      });
      if (!viaProvider) {
        const lineId = await this.folios.postRefundLineInTx(tx, folio.id, {
          amountMinor: BigInt(amountMinor),
          description: `Refund (${payment.method.replace('_', ' ').toLowerCase()})`,
          reason,
        });
        await tx.refund.update({ where: { id: refund.id }, data: { folioLineId: lineId } });
      }
      await this.audit.record(tx, {
        action: 'payment.refunded',
        entityType: 'payment',
        entityId: paymentId,
        propertyId,
        after: { refundId: refund.id, amountMinor, reason },
      });
      return { refund, payment };
    });

    if (created.payment.provider) {
      const provider = this.payments.providerFor(created.payment.provider);
      let result: { reference: string; status: 'SUCCEEDED' | 'PENDING' } | 'REFUSED' | 'UNKNOWN';
      try {
        result = provider
          ? await provider.refund({
              paymentReference: created.payment.reference ?? '',
              amountMinor,
              currency: created.payment.currency,
            })
          : 'REFUSED';
      } catch (error) {
        // Only a clear "no" frees the amount again. A timeout or outage may have refunded
        // at the provider, so the refund stays PENDING (still counted against the cap) and
        // shows in reconciliation instead of inviting a second, real refund.
        const refused =
          error instanceof ProblemException && error.code === 'PAYMENT_PROVIDER_REJECTED';
        if (!refused) {
          this.cls
            .get('log')
            ?.warn({ err: error, refundId: created.refund.id }, 'refund outcome unknown');
        }
        result = refused ? 'REFUSED' : 'UNKNOWN';
      }
      await this.db.run(async (tx) => {
        if (result === 'UNKNOWN') return;
        if (result === 'REFUSED') {
          await tx.refund.update({
            where: { id: created.refund.id },
            data: { status: 'FAILED', completedAt: new Date() },
          });
          return;
        }
        if (result.status === 'SUCCEEDED') {
          const lineId = await this.folios.postRefundLineInTx(tx, created.refund.folioId, {
            amountMinor: BigInt(amountMinor),
            description: 'Refund (online)',
            reason,
          });
          await tx.refund.update({
            where: { id: created.refund.id },
            data: {
              status: 'SUCCEEDED',
              providerRef: result.reference,
              folioLineId: lineId,
              completedAt: new Date(),
            },
          });
        } else {
          await tx.refund.update({
            where: { id: created.refund.id },
            data: { providerRef: result.reference },
          });
        }
      });
    }
    const row = await this.db.run(async (tx) => {
      const refund = await tx.refund.findUniqueOrThrow({
        where: { id: created.refund.id },
        include,
      });
      await this.outbox.enqueue(
        tx,
        'RefundIssued',
        { refundId: refund.id, paymentId, amountMinor, status: refund.status },
        { propertyId },
      );
      return refund;
    });
    if (row.status === 'FAILED') {
      throw new ProblemException(
        502,
        'INTERNAL_ERROR',
        'Refund failed',
        'The payment provider refused the refund.',
      );
    }
    return toRefundDto(row);
  }

  async refunds(propertyId: string, paymentId: string): Promise<Refund[]> {
    const rows = await this.db.run((tx: Tx) =>
      tx.refund.findMany({
        where: { paymentId, propertyId },
        include: { payment: { select: { method: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map(toRefundDto);
  }
}
