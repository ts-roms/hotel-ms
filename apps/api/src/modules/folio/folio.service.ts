import { Inject, Injectable } from '@nestjs/common';
import type {
  AdjustmentRequest,
  CreateTaxRuleRequest,
  Folio,
  PostChargeRequest,
  AccountFolio,
  RecordPaymentRequest,
  RoutingRule,
  TaxRule,
} from '@hotel/contracts';
import { Prisma, type Tx, uuidv7 } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate, toDbDate } from '../../common/dates.js';
import { nextNumber } from '../../common/numbering.js';
import { ProblemException, Problems, invalidState } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { SECRET_BOX } from '../../infrastructure/secret-box.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { businessDateOf } from '../pms/rooms.service.js';
import { convertMinor, currencyDigits, formatRate, toMinor } from '../../common/money.js';
import type { SecretBox } from '../../infrastructure/secret-box.js';
import { applyStatutoryDiscount, computeTaxes, type TaxRuleInput } from './tax-engine.js';

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

const folioInclude = {
  lines: { orderBy: [{ postedAt: 'asc' }, { id: 'asc' }] },
  payments: {
    orderBy: { createdAt: 'asc' },
    include: { refunds: { select: { amountMinor: true, status: true } } },
  },
  discountProfile: { select: { id: true, code: true, name: true } },
} satisfies Prisma.FolioInclude;

type FolioRow = Prisma.FolioGetPayload<{ include: typeof folioInclude }>;

function toFolioDto(folio: FolioRow): Folio {
  const reversed = new Set(folio.lines.map((l) => l.reversesLineId).filter(Boolean));
  return {
    id: folio.id,
    folioNo: folio.folioNo,
    status: folio.status,
    currency: folio.currency,
    balanceMinor: toSignedMinor(folio.balanceMinor),
    reservationRoomId: folio.reservationRoomId,
    label: folio.label,
    discount:
      folio.discountProfile && folio.discountHolderName && folio.discountIdLast4
        ? {
            profileId: folio.discountProfile.id,
            code: folio.discountProfile.code,
            name: folio.discountProfile.name,
            holderName: folio.discountHolderName,
            idLast4: folio.discountIdLast4,
          }
        : null,
    lines: folio.lines.map((l) => ({
      id: l.id,
      businessDate: fromDbDate(l.businessDate),
      type: l.type,
      department: l.department,
      description: l.description,
      amountMinor: toSignedMinor(l.amountMinor),
      taxCode: l.taxCode,
      parentLineId: l.parentLineId,
      reversesLineId: l.reversesLineId,
      reversed: reversed.has(l.id),
      reason: l.reason,
      postedAt: l.postedAt.toISOString(),
    })),
    payments: folio.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amountMinor: toMinor(p.amountMinor),
      refundedMinor: toMinor(
        p.refunds.filter((r) => r.status !== 'FAILED').reduce((sum, r) => sum + r.amountMinor, 0n),
      ),
      provider: p.provider,
      tendered:
        p.tenderedCurrency && p.tenderedAmountMinor !== null && p.exchangeRateMicros !== null
          ? {
              currency: p.tenderedCurrency,
              amountMinor: toMinor(p.tenderedAmountMinor),
              rate: formatRate(p.exchangeRateMicros),
            }
          : null,
      reference: p.reference,
      businessDate: fromDbDate(p.businessDate),
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

function toSignedMinor(value: bigint): number {
  return value < 0n ? -toMinor(-value) : toMinor(value);
}

/**
 * The guest folio is an append-only ledger (§15.1). Every mutation here is an INSERT;
 * the database keeps the balance (trigger), refuses edits and deletes, and refuses
 * postings to closed folios.
 */
@Injectable()
export class FolioService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(SECRET_BOX) private readonly secretBox: SecretBox,
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

  private async requireFolio(tx: Tx, folioId: string) {
    const folio = await tx.folio.findFirst({
      where: { id: folioId, propertyId: this.ctx.propertyId },
    });
    if (!folio) throw Problems.notFound('Folio');
    return folio;
  }

  private async load(tx: Tx, folioId: string): Promise<Folio> {
    const folio = await tx.folio.findFirst({
      where: { id: folioId, propertyId: this.ctx.propertyId },
      include: folioInclude,
    });
    if (!folio) throw Problems.notFound('Folio');
    return toFolioDto(folio);
  }

  get(folioId: string): Promise<Folio> {
    return this.db.run((tx) => this.load(tx, folioId));
  }

  async findForReservationRoom(reservationRoomId: string): Promise<Folio> {
    return this.db.run(async (tx) => {
      const folio = await tx.folio.findFirst({
        where: { reservationRoomId, propertyId: this.ctx.propertyId },
      });
      if (!folio) throw Problems.notFound('Folio');
      return this.load(tx, folio.id);
    });
  }

  /**
   * Posts a charge (or adjustment) as a net line plus one line per applicable tax.
   * With a sourceKey, a repeated posting returns without posting twice.
   */
  async postInTx(tx: Tx, folioId: string, input: PostingInput): Promise<string> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const folio = await this.requireFolio(tx, folioId);
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
    let rules = input.taxRules ?? (await this.taxRulesFor(tx, propertyId, input.department));
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

  /** Active tax rules for a department, in posting order. */
  async taxRulesFor(tx: Tx, propertyId: string, department: string): Promise<TaxRuleInput[]> {
    const rules = await tx.taxRule.findMany({
      where: { propertyId, archivedAt: null, departments: { has: department } },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rules.map((r) => ({
      code: r.code,
      name: r.name,
      rateBps: r.rateBps,
      inclusive: r.inclusive,
    }));
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
    const folio = await this.requireFolio(tx, folioId);
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
      return this.load(tx, folioId);
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
      return this.load(tx, folioId);
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
    const folio = await this.requireFolio(tx, folioId);
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
      return this.load(tx, folioId);
    });
  }

  /** Money given back: a positive REFUND line (the payer's balance goes up). */
  async postRefundLineInTx(
    tx: Tx,
    folioId: string,
    input: { amountMinor: bigint; description: string; reason: string },
  ): Promise<string> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const folio = await this.requireFolio(tx, folioId);
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

  // ---- Statutory discounts -------------------------------------------------------------

  /** Applies a discount profile to a folio; its later charges are discounted (§15.1). */
  async applyDiscount(
    folioId: string,
    input: { profileId: string; holderName: string; idNumber: string },
  ): Promise<Folio> {
    const { propertyId } = this.ctx;
    return this.db.run(async (tx) => {
      const folio = await this.requireFolio(tx, folioId);
      if (folio.status !== 'OPEN') throw invalidState('The folio is closed.');
      const profile = await tx.discountProfile.findFirst({
        where: { id: input.profileId, propertyId, archivedAt: null },
      });
      if (!profile) throw Problems.validation([{ path: 'profileId', message: 'Unknown discount' }]);
      const id = input.idNumber.replace(/\s+/g, '');
      await tx.folio.update({
        where: { id: folioId },
        data: {
          discountProfileId: profile.id,
          discountHolderName: input.holderName,
          discountIdLast4: id.slice(-4),
          // Bound to this folio, so a copied ciphertext cannot be read elsewhere.
          discountIdEncrypted: new Uint8Array(
            this.secretBox.encrypt(id, `folio-discount:${folioId}`),
          ),
        },
      });
      await this.audit.record(tx, {
        action: 'folio.discount_applied',
        entityType: 'folio',
        entityId: folioId,
        propertyId,
        after: { profile: profile.code, holderName: input.holderName, idLast4: id.slice(-4) },
      });
      await this.outbox.enqueue(
        tx,
        'FolioDiscountApplied',
        { folioId, profileCode: profile.code },
        { propertyId },
      );
      return this.load(tx, folioId);
    });
  }

  async removeDiscount(folioId: string): Promise<Folio> {
    const { propertyId } = this.ctx;
    return this.db.run(async (tx) => {
      const folio = await this.requireFolio(tx, folioId);
      if (!folio.discountProfileId) return this.load(tx, folioId);
      await tx.folio.update({
        where: { id: folioId },
        data: {
          discountProfileId: null,
          discountHolderName: null,
          discountIdLast4: null,
          discountIdEncrypted: null,
        },
      });
      await this.audit.record(tx, {
        action: 'folio.discount_removed',
        entityType: 'folio',
        entityId: folioId,
        propertyId,
      });
      return this.load(tx, folioId);
    });
  }

  // ---- Accounts, routing and transfers -----------------------------------------------------

  /** Company / group master account: a folio without a stay (city ledger). */
  async createAccount(label: string): Promise<Folio> {
    const { organizationId, propertyId } = this.ctx;
    return this.db.run(async (tx) => {
      const property = await tx.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { code: true, currency: true },
      });
      const n = await nextNumber(tx, organizationId, propertyId, 'folio');
      const folio = await tx.folio.create({
        data: {
          organizationId,
          propertyId,
          folioNo: `${property.code}-F${String(n).padStart(6, '0')}`,
          label,
          currency: property.currency,
        },
      });
      await this.audit.record(tx, {
        action: 'folio.account_created',
        entityType: 'folio',
        entityId: folio.id,
        propertyId,
        after: { label },
      });
      return this.load(tx, folio.id);
    });
  }

  async accounts(): Promise<AccountFolio[]> {
    const rows = await this.db.run((tx) =>
      tx.folio.findMany({
        where: { propertyId: this.ctx.propertyId, reservationRoomId: null, label: { not: null } },
        orderBy: { label: 'asc' },
      }),
    );
    return rows.map((f) => ({
      id: f.id,
      folioNo: f.folioNo,
      label: f.label!,
      status: f.status,
      balanceMinor: toSignedMinor(f.balanceMinor),
    }));
  }

  async routingRules(folioId: string): Promise<RoutingRule[]> {
    return this.db.run(async (tx) => {
      await this.requireFolio(tx, folioId);
      const rows = await tx.folioRoutingRule.findMany({
        where: { sourceFolioId: folioId, removedAt: null },
        include: { target: { select: { folioNo: true, label: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        sourceFolioId: r.sourceFolioId,
        targetFolioId: r.targetFolioId,
        targetFolioNo: r.target.folioNo,
        targetLabel: r.target.label,
        departments: r.departments as RoutingRule['departments'],
      }));
    });
  }

  async addRoutingRule(
    folioId: string,
    targetFolioId: string,
    departments: string[],
  ): Promise<RoutingRule[]> {
    const { organizationId, propertyId, actorId } = this.ctx;
    await this.db.run(async (tx) => {
      const source = await this.requireFolio(tx, folioId);
      const target = await tx.folio.findFirst({ where: { id: targetFolioId, propertyId } });
      if (!target || target.id === source.id) {
        throw Problems.validation([{ path: 'targetFolioId', message: 'Unknown or same folio' }]);
      }
      if (source.status !== 'OPEN' || target.status !== 'OPEN') {
        throw invalidState('Both folios must be open.');
      }
      const overlapping = await tx.folioRoutingRule.count({
        where: { sourceFolioId: folioId, removedAt: null, departments: { hasSome: departments } },
      });
      if (overlapping) throw Problems.conflict('A department is already routed from this folio.');
      const rule = await tx.folioRoutingRule.create({
        data: {
          organizationId,
          propertyId,
          sourceFolioId: folioId,
          targetFolioId,
          departments,
          createdBy: actorId,
        },
      });
      await this.audit.record(tx, {
        action: 'folio.routing_added',
        entityType: 'folio',
        entityId: folioId,
        propertyId,
        after: { ruleId: rule.id, targetFolioId, departments },
      });
    });
    return this.routingRules(folioId);
  }

  async removeRoutingRule(ruleId: string): Promise<void> {
    await this.db.run(async (tx) => {
      const { count } = await tx.folioRoutingRule.updateMany({
        where: { id: ruleId, propertyId: this.ctx.propertyId, removedAt: null },
        data: { removedAt: new Date() },
      });
      if (count !== 1) throw Problems.notFound('Routing rule');
      await this.audit.record(tx, {
        action: 'folio.routing_removed',
        entityType: 'folio_routing_rule',
        entityId: ruleId,
        propertyId: this.ctx.propertyId,
      });
    });
  }

  /**
   * Moves charges (with their taxes) to another folio as a TRANSFER pair. The source side
   * references the charge, so a charge moves once and a moved charge cannot be voided.
   */
  async transfer(
    folioId: string,
    input: { targetFolioId: string; lineIds: string[]; reason: string },
  ): Promise<Folio> {
    const { organizationId, propertyId, actorId } = this.ctx;
    return this.db.run(async (tx) => {
      const source = await this.requireFolio(tx, folioId);
      const target = await tx.folio.findFirst({ where: { id: input.targetFolioId, propertyId } });
      if (!target || target.id === source.id) {
        throw Problems.validation([{ path: 'targetFolioId', message: 'Unknown or same folio' }]);
      }
      if (source.currency !== target.currency) {
        throw invalidState('The folios use different currencies.');
      }
      const businessDate = toDbDate(await businessDateOf(tx, propertyId));
      for (const lineId of [...new Set(input.lineIds)]) {
        const charge = await tx.folioLine.findFirst({
          where: { id: lineId, folioId, type: 'CHARGE' },
        });
        if (!charge) {
          throw Problems.validation([
            { path: 'lineIds', message: 'Only charges of this folio can move' },
          ]);
        }
        if (await tx.folioLine.count({ where: { reversesLineId: lineId } })) {
          throw invalidState(`"${charge.description}" was already voided or moved.`);
        }
        const taxes = await tx.folioLine.aggregate({
          where: { parentLineId: lineId },
          _sum: { amountMinor: true },
        });
        const gross = charge.amountMinor + (taxes._sum.amountMinor ?? 0n);
        const transferId = uuidv7();
        await tx.folioLine.create({
          data: {
            organizationId,
            propertyId,
            folioId,
            businessDate,
            type: 'TRANSFER',
            department: charge.department,
            description: `Moved to ${target.folioNo}: ${charge.description}`,
            amountMinor: -gross,
            currency: charge.currency,
            reversesLineId: charge.id,
            transferId,
            reason: input.reason,
            postedBy: actorId,
          },
        });
        await tx.folioLine.create({
          data: {
            organizationId,
            propertyId,
            folioId: target.id,
            businessDate,
            type: 'TRANSFER',
            department: charge.department,
            description: `From ${source.folioNo}: ${charge.description}`,
            amountMinor: gross,
            currency: charge.currency,
            transferId,
            reason: input.reason,
            postedBy: actorId,
          },
        });
      }
      await this.audit.record(tx, {
        action: 'folio.transferred',
        entityType: 'folio',
        entityId: folioId,
        propertyId,
        after: { targetFolioId: target.id, lineIds: input.lineIds, reason: input.reason },
      });
      return this.load(tx, folioId);
    });
  }

  /**
   * Voids a charge posted today: posts exact negations of the charge and its tax lines.
   * After the business day has closed, corrections are adjustments instead.
   */
  async voidLine(folioId: string, lineId: string, reason: string): Promise<Folio> {
    const { propertyId } = this.ctx;
    return this.db.run(async (tx) => {
      const folio = await this.requireFolio(tx, folioId);
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
      return this.load(tx, folioId);
    });
  }

  // ---- Tax configuration ------------------------------------------------------------------

  async listTaxRules(): Promise<TaxRule[]> {
    const rows = await this.db.run((tx) =>
      tx.taxRule.findMany({
        where: { propertyId: this.ctx.propertyId },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      rateBps: r.rateBps,
      inclusive: r.inclusive,
      departments: r.departments as TaxRule['departments'],
      archived: r.archivedAt !== null,
    }));
  }

  /** New rules apply to postings from now on; history keeps the tax it was posted with. */
  async createTaxRule(input: CreateTaxRuleRequest): Promise<TaxRule> {
    const { organizationId, propertyId, actorId } = this.ctx;
    try {
      const rule = await this.db.run(async (tx) => {
        const created = await tx.taxRule.create({
          data: { organizationId, propertyId, ...input, createdBy: actorId },
        });
        await this.audit.record(tx, {
          action: 'tax_rule.created',
          entityType: 'tax_rule',
          entityId: created.id,
          propertyId,
          after: input,
        });
        return created;
      });
      return (await this.listTaxRules()).find((r) => r.id === rule.id)!;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw Problems.conflict(`A tax with code ${input.code} already exists.`);
      }
      throw error;
    }
  }

  async archiveTaxRule(taxRuleId: string): Promise<void> {
    const { propertyId } = this.ctx;
    await this.db.run(async (tx) => {
      const rule = await tx.taxRule.findFirst({ where: { id: taxRuleId, propertyId } });
      if (!rule) throw Problems.notFound('Tax rule');
      if (rule.archivedAt) return;
      await tx.taxRule.update({ where: { id: taxRuleId }, data: { archivedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'tax_rule.archived',
        entityType: 'tax_rule',
        entityId: taxRuleId,
        propertyId,
      });
    });
  }
}
