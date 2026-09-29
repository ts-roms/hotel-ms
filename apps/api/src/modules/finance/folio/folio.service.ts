import { Injectable } from '@nestjs/common';
import type {
  AdjustmentRequest,
  Folio,
  PostChargeRequest,
  RecordPaymentRequest,
} from '@hotel/contracts';
import type { Tx } from '@hotel/database';
import { currencyDigits } from '@hotel/format';
import { ClsService } from 'nestjs-cls';
import { businessDateOf } from '../../../common/business-date.js';
import { fromDbDate, toDbDate } from '../../../common/dates.js';
import { convertMinor, formatRate, toMinor } from '../../../common/money.js';
import { nextNumber } from '../../../common/numbering.js';
import { ProblemException, Problems, invalidState } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import {
  applyStatutoryDiscount,
  computeTaxes,
  type TaxRuleInput,
} from '../../pms/pricing/tax-engine.js';
import { TaxRulesService } from '../../pms/pricing/tax-rules.service.js';
import { folioInclude, toFolioDto } from './folio-dto.js';

/** Foreign cash amount in major units, for line descriptions ("100", "1.5"). */
const formatForeign = (t: { currency: string; amountMinor: bigint }) =>
  String(Number(t.amountMinor) / 10 ** currencyDigits(t.currency));

export interface PostingInput {
  department: string;
  description: string;
  /** As charged: tax-inclusive where the department's taxes are inclusive. */
  amountMinor: bigint;
  type?: 'CHARGE' | 'ADJUSTMENT';
  /** Makes the posting idempotent within the folio. */
  sourceKey?: string;
  /** Post here even if a routing rule would send the charge elsewhere. */
  noRouting?: boolean;
  reason?: string;
  businessDate?: string;
  /** Tax rules snapshotted by the caller (e.g. at order time) instead of today's rules. */
  taxRules?: readonly TaxRuleInput[];
}

/**
 * The guest folio is an append-only ledger (§15.1). Every mutation here is an INSERT;
 * the database keeps the balance (trigger), refuses edits and deletes, and refuses
 * postings to closed folios. Discounts (FolioDiscountsService) and accounts, routing and
 * transfers (FolioRoutingService) build on the helpers here.
 */
@Injectable()
export class FolioService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
    private readonly taxRules: TaxRulesService,
  ) {}

  private get ctx() {
    return {
      organizationId: this.cls.get('organizationId')!,
      propertyId: this.cls.get('propertyId')!,
      actorId: this.cls.get('identityId') ?? null,
    };
  }

  async openInTx(tx: Tx, reservationRoomId: string, currency: string): Promise<{ id: string }> {
    const { organizationId, propertyId } = this.ctx;
    const property = await tx.property.findUniqueOrThrow({
      where: { id: propertyId },
      select: { code: true },
    });
    const n = await nextNumber(tx, organizationId, propertyId, 'folio');
    return tx.folio.create({
      data: {
        organizationId,
        propertyId,
        folioNo: `${property.code}-F${String(n).padStart(6, '0')}`,
        reservationRoomId,
        currency,
      },
      select: { id: true },
    });
  }

  /** Closes a settled folio on check-out, inside Front Office's transaction. */
  async closeInTx(tx: Tx, folioId: string): Promise<void> {
    await tx.folio.update({
      where: { id: folioId },
      data: { status: 'CLOSED', closedAt: new Date(), version: { increment: 1 } },
    });
  }

  /** The folio at the current property; 404 otherwise. */
  async requireInTx(tx: Tx, folioId: string) {
    const folio = await tx.folio.findFirst({
      where: { id: folioId, propertyId: this.ctx.propertyId },
    });
    if (!folio) throw Problems.notFound('Folio');
    return folio;
  }

  /** The folio as the API returns it. */
  async loadInTx(tx: Tx, folioId: string): Promise<Folio> {
    const folio = await tx.folio.findFirst({
      where: { id: folioId, propertyId: this.ctx.propertyId },
      include: folioInclude,
    });
    if (!folio) throw Problems.notFound('Folio');
    return toFolioDto(folio);
  }

  get(folioId: string): Promise<Folio> {
    return this.db.run((tx) => this.loadInTx(tx, folioId));
  }

  async findForReservationRoom(reservationRoomId: string): Promise<Folio> {
    return this.db.run(async (tx) => {
      const folio = await tx.folio.findFirst({
        where: { reservationRoomId, propertyId: this.ctx.propertyId },
      });
      if (!folio) throw Problems.notFound('Folio');
      return this.loadInTx(tx, folio.id);
    });
  }

  /**
   * Posts a charge (or adjustment) as a net line plus one line per applicable tax.
   * With a sourceKey, a repeated posting returns without posting twice.
   */
  async postInTx(tx: Tx, folioId: string, input: PostingInput): Promise<string> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const folio = await this.requireInTx(tx, folioId);
    if (folio.status !== 'OPEN') throw invalidState('The folio is closed.');
    if (!input.noRouting && (input.type ?? 'CHARGE') === 'CHARGE') {
      // Routing (§15.1): e.g. the company account pays the room, the guest the extras.
      const rule = await tx.folioRoutingRule.findFirst({
        where: { sourceFolioId: folioId, removedAt: null, departments: { has: input.department } },
        include: { target: { select: { id: true, status: true } } },
      });
      if (rule && rule.target.status === 'OPEN') {
        return this.postInTx(tx, rule.target.id, {
          ...input,
          description: `${input.description} (${folio.folioNo})`,
          noRouting: true,
        });
      }
    }
    if (input.sourceKey) {
      const existing = await tx.folioLine.findFirst({
        where: { folioId, sourceKey: input.sourceKey },
      });
      if (existing) return existing.id;
    }
    const businessDate = input.businessDate ?? (await businessDateOf(tx, propertyId));
    let rules =
      input.taxRules ?? (await this.taxRules.taxRulesFor(tx, propertyId, input.department));
    let amount = input.amountMinor;
    let description = input.description;
    const type = input.type ?? 'CHARGE';
    // Statutory discount on this folio (e.g. PH senior citizen / PWD): exempt taxes are
    // taken out, and the discount follows as its own line linked to the charge.
    let discount: { amount: bigint; label: string } | null = null;
    if (type === 'CHARGE' && folio.discountProfileId) {
      const profile = await tx.discountProfile.findUnique({
        where: { id: folio.discountProfileId },
      });
      if (profile && !profile.archivedAt && profile.departments.includes(input.department)) {
        const applied = applyStatutoryDiscount(amount, rules, profile);
        amount = applied.base;
        rules = applied.rules;
        if (profile.exemptTaxCodes.length > 0) {
          description = `${description} (${profile.exemptTaxCodes.join(', ')}-exempt)`;
        }
        if (applied.discount > 0n) {
          discount = {
            amount: applied.discount,
            label: `${profile.name} discount (${profile.discountBps / 100}%)`,
          };
        }
      }
    }
    const breakdown = computeTaxes(amount, rules);

    const line = await tx.folioLine.create({
      data: {
        organizationId,
        propertyId,
        folioId,
        businessDate: toDbDate(businessDate),
        type,
        department: input.department,
        description,
        amountMinor: breakdown.netMinor,
        currency: folio.currency,
        sourceKey: input.sourceKey ?? null,
        reason: input.reason ?? null,
        postedBy: actorId,
      },
    });
    for (const tax of breakdown.taxes) {
      await tx.folioLine.create({
        data: {
          organizationId,
          propertyId,
          folioId,
          businessDate: toDbDate(businessDate),
          type: type === 'CHARGE' ? 'TAX' : 'ADJUSTMENT',
          department: input.department,
          description: tax.name,
          amountMinor: tax.amountMinor,
          currency: folio.currency,
          parentLineId: line.id,
          taxCode: tax.code,
          postedBy: actorId,
        },
      });
    }
    if (discount) {
      await tx.folioLine.create({
        data: {
          organizationId,
          propertyId,
          folioId,
          businessDate: toDbDate(businessDate),
          type: 'ADJUSTMENT',
          department: input.department,
          description: discount.label,
          amountMinor: -discount.amount,
          currency: folio.currency,
          parentLineId: line.id,
          reason: 'Statutory discount',
          postedBy: actorId,
        },
      });
    }
    await this.outbox.enqueue(
      tx,
      'FolioLinePosted',
      {
        folioId,
        lineId: line.id,
        type,
        amountMinor: Number(breakdown.totalMinor - (discount?.amount ?? 0n)),
      },
      { propertyId },
    );
    return line.id;
  }

  /** Exact negation of a charge and its taxes (same business day only). */
  private async reverseLinesInTx(
    tx: Tx,
    folioId: string,
    line: {
      id: string;
      department: string;
      description: string;
      amountMinor: bigint;
      currency: string;
      taxCode: string | null;
    },
    businessDate: string,
    reason: string,
  ): Promise<void> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const taxes = await tx.folioLine.findMany({ where: { parentLineId: line.id } });
    for (const original of [line, ...taxes]) {
      await tx.folioLine.create({
        data: {
          organizationId,
          propertyId,
          folioId,
          businessDate: toDbDate(businessDate),
          type: 'REVERSAL',
          department: original.department,
          description: `Void: ${original.description}`,
          amountMinor: -original.amountMinor,
          currency: original.currency,
          reversesLineId: original.id,
          taxCode: original.taxCode,
          reason,
          postedBy: actorId,
        },
      });
    }
  }

  /**
   * Takes back a sourced posting (e.g. a cancelled order), once: a reversal on the same
   * business day, otherwise a negative adjustment with the same tax rules.
   */
  async reverseSourceInTx(
    tx: Tx,
    folioId: string,
    input: {
      sourceKey: string;
      amountMinor: bigint;
      reason: string;
      taxRules?: readonly TaxRuleInput[];
    },
  ): Promise<void> {
    const folio = await this.requireInTx(tx, folioId);
    if (folio.status !== 'OPEN') throw invalidState('The folio is closed.');
    const line = await tx.folioLine.findFirst({ where: { folioId, sourceKey: input.sourceKey } });
    if (!line) return;
    const reversed = await tx.folioLine.count({
      where: {
        folioId,
        OR: [{ reversesLineId: line.id }, { sourceKey: `${input.sourceKey}:reversal` }],
      },
    });
    if (reversed > 0) return;
    const businessDate = await businessDateOf(tx, this.ctx.propertyId);
    if (fromDbDate(line.businessDate) === businessDate) {
      await this.reverseLinesInTx(tx, folioId, line, businessDate, input.reason);
    } else {
      await this.postInTx(tx, folioId, {
        department: line.department,
        description: `Reversal: ${line.description}`,
        amountMinor: -input.amountMinor,
        type: 'ADJUSTMENT',
        reason: input.reason,
        sourceKey: `${input.sourceKey}:reversal`,
        taxRules: input.taxRules,
      });
    }
  }

  async postCharge(folioId: string, input: PostChargeRequest): Promise<Folio> {
    return this.db.run(async (tx) => {
      const lineId = await this.postInTx(tx, folioId, {
        ...input,
        amountMinor: BigInt(input.amountMinor),
      });
      await this.audit.record(tx, {
        action: 'folio.charge_posted',
        entityType: 'folio',
        entityId: folioId,
        propertyId: this.ctx.propertyId,
        after: { lineId, ...input },
      });
      return this.loadInTx(tx, folioId);
    });
  }

  async adjust(folioId: string, input: AdjustmentRequest): Promise<Folio> {
    return this.db.run(async (tx) => {
      const lineId = await this.postInTx(tx, folioId, {
        department: input.department,
        description: input.description,
        amountMinor: BigInt(input.amountMinor),
        type: 'ADJUSTMENT',
        reason: input.reason,
      });
      await this.audit.record(tx, {
        action: 'folio.adjusted',
        entityType: 'folio',
        entityId: folioId,
        propertyId: this.ctx.propertyId,
        after: { lineId, ...input },
      });
      return this.loadInTx(tx, folioId);
    });
  }

  /** The caller's open cashier shift at this property, if any. */
  async openShiftInTx(tx: Tx): Promise<{ id: string } | null> {
    const membershipId = this.cls.get('membershipId');
    if (!membershipId) return null;
    return tx.cashierShift.findFirst({
      where: { membershipId, propertyId: this.ctx.propertyId, status: 'OPEN' },
      select: { id: true },
    });
  }

  /**
   * Posts a payment line and its payment record. Cash taken at the desk must go into the
   * cashier's open shift, so the drawer can be reconciled (§15.2).
   */
  async recordPaymentInTx(
    tx: Tx,
    folioId: string,
    input: RecordPaymentRequest & { provider?: string; intentId?: string },
  ): Promise<string> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const folio = await this.requireInTx(tx, folioId);
    if (folio.status !== 'OPEN') throw invalidState('The folio is closed.');
    let cashierShiftId: string | null = null;
    if (input.method === 'CASH' && !input.provider) {
      const shift = await this.openShiftInTx(tx);
      if (!shift) {
        throw new ProblemException(
          409,
          'CASHIER_SHIFT_REQUIRED',
          'Open a cashier shift',
          'Cash goes into a cashier shift. Open yours before taking cash.',
        );
      }
      cashierShiftId = shift.id;
    }
    const businessDate = toDbDate(await businessDateOf(tx, propertyId));
    let amount: bigint;
    let tendered: { currency: string; amountMinor: bigint; rateMicros: bigint } | null = null;
    if (input.tendered) {
      if (input.tendered.currency === folio.currency) {
        throw Problems.validation([
          { path: 'tendered.currency', message: 'Use amountMinor for the folio currency' },
        ]);
      }
      // The rate in force now; rates are history rows, never edited.
      const rate = await tx.exchangeRate.findFirst({
        where: {
          propertyId,
          currency: input.tendered.currency,
          effectiveFrom: { lte: new Date() },
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!rate) {
        throw new ProblemException(
          409,
          'NO_EXCHANGE_RATE',
          'No exchange rate',
          `Set a ${input.tendered.currency} exchange rate before taking that currency.`,
        );
      }
      tendered = {
        currency: input.tendered.currency,
        amountMinor: BigInt(input.tendered.amountMinor),
        rateMicros: rate.rateMicros,
      };
      amount = convertMinor(
        tendered.amountMinor,
        tendered.currency,
        rate.rateMicros,
        folio.currency,
      );
    } else {
      amount = BigInt(input.amountMinor!);
    }
    const method = input.method.replace('_', ' ').toLowerCase();
    const line = await tx.folioLine.create({
      data: {
        organizationId,
        propertyId,
        folioId,
        businessDate,
        type: 'PAYMENT',
        department: 'PAYMENT',
        description: input.provider
          ? `Online payment (${method})`
          : tendered
            ? `Payment (cash ${tendered.currency} ${formatForeign(tendered)})`
            : `Payment (${method})`,
        amountMinor: -amount,
        currency: folio.currency,
        postedBy: actorId,
      },
    });
    const payment = await tx.payment.create({
      data: {
        organizationId,
        propertyId,
        folioId,
        folioLineId: line.id,
        method: input.method,
        amountMinor: amount,
        currency: folio.currency,
        reference: input.reference,
        businessDate,
        receivedBy: actorId,
        provider: input.provider ?? null,
        intentId: input.intentId ?? null,
        cashierShiftId,
        tenderedCurrency: tendered?.currency ?? null,
        tenderedAmountMinor: tendered?.amountMinor ?? null,
        exchangeRateMicros: tendered?.rateMicros ?? null,
      },
    });
    await this.audit.record(tx, {
      action: 'payment.recorded',
      entityType: 'folio',
      entityId: folioId,
      propertyId,
      after: {
        paymentId: payment.id,
        method: input.method,
        amountMinor: toMinor(amount),
        reference: input.reference,
        provider: input.provider ?? null,
        tendered: tendered
          ? {
              currency: tendered.currency,
              amountMinor: toMinor(tendered.amountMinor),
              rate: formatRate(tendered.rateMicros),
            }
          : null,
      },
    });
    await this.outbox.enqueue(
      tx,
      'PaymentRecorded',
      { folioId, paymentId: payment.id, method: input.method, amountMinor: toMinor(amount) },
      { propertyId },
    );
    return payment.id;
  }

  async recordPayment(folioId: string, input: RecordPaymentRequest): Promise<Folio> {
    return this.db.run(async (tx) => {
      await this.recordPaymentInTx(tx, folioId, input);
      return this.loadInTx(tx, folioId);
    });
  }

  /** Money given back: a positive REFUND line (the payer's balance goes up). */
  async postRefundLineInTx(
    tx: Tx,
    folioId: string,
    input: { amountMinor: bigint; description: string; reason: string },
  ): Promise<string> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const folio = await this.requireInTx(tx, folioId);
    if (folio.status !== 'OPEN') throw invalidState('The folio is closed.');
    const line = await tx.folioLine.create({
      data: {
        organizationId,
        propertyId,
        folioId,
        businessDate: toDbDate(await businessDateOf(tx, propertyId)),
        type: 'REFUND',
        department: 'PAYMENT',
        description: input.description,
        amountMinor: input.amountMinor,
        currency: folio.currency,
        reason: input.reason,
        postedBy: actorId,
      },
    });
    return line.id;
  }

  /**
   * Voids a charge posted today: posts exact negations of the charge and its tax lines.
   * After the business day has closed, corrections are adjustments instead.
   */
  async voidLine(folioId: string, lineId: string, reason: string): Promise<Folio> {
    const { propertyId } = this.ctx;
    return this.db.run(async (tx) => {
      const folio = await this.requireInTx(tx, folioId);
      const line = await tx.folioLine.findFirst({ where: { id: lineId, folioId } });
      if (!line) throw Problems.notFound('Folio line');
      if (line.type !== 'CHARGE')
        throw invalidState('Only charges can be voided. Use an adjustment otherwise.');
      const businessDate = await businessDateOf(tx, propertyId);
      if (fromDbDate(line.businessDate) !== businessDate) {
        throw new ProblemException(
          409,
          'INVALID_STATE',
          'Business day closed',
          'This charge belongs to a closed business day. Post an adjustment instead.',
        );
      }
      if (folio.status !== 'OPEN') throw invalidState('The folio is closed.');
      const already = await tx.folioLine.count({ where: { reversesLineId: lineId } });
      if (already > 0) throw invalidState('This charge has already been voided.');

      await this.reverseLinesInTx(tx, folioId, line, businessDate, reason);
      await this.audit.record(tx, {
        action: 'folio.line_voided',
        entityType: 'folio',
        entityId: folioId,
        propertyId,
        after: { lineId, reason },
      });
      return this.loadInTx(tx, folioId);
    });
  }
}
