import { Injectable } from '@nestjs/common';
import type { DailyReport, Reconciliation } from '@hotel/contracts';
import { fromDbDate, toDbDate } from '../../common/dates.js';
import { TenantDb } from '../../infrastructure/database.js';
import { toMinor } from '../pms/pricing.js';

const signed = (v: bigint | null) => (v === null ? 0 : v < 0n ? -toMinor(-v) : toMinor(v));

/**
 * Financial reports (blueprint §15): the day's revenue, tax, payments and refunds by
 * business date, and a reconciliation check of the ledger against its caches and the
 * payment gateway state.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly db: TenantDb) {}

  async daily(propertyId: string, date?: string): Promise<DailyReport> {
    return this.db.run(async (tx) => {
      const property = await tx.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { currency: true, currentBusinessDate: true },
      });
      const businessDate = date ?? fromDbDate(property.currentBusinessDate);
      const day = toDbDate(businessDate);
      // Revenue: charges and their corrections without a tax code; taxes: lines with one.
      // Transfers only move balances between folios and are not revenue.
      const revenue = await tx.$queryRaw<{ department: string; net: bigint }[]>`
        SELECT department, sum(amount_minor)::bigint AS net FROM folio_lines
        WHERE property_id = ${propertyId}::uuid AND business_date = ${day}
          AND type::text IN ('CHARGE', 'ADJUSTMENT', 'REVERSAL') AND tax_code IS NULL
        GROUP BY department ORDER BY department`;
      const taxes = await tx.$queryRaw<{ code: string; amount: bigint }[]>`
        SELECT tax_code AS code, sum(amount_minor)::bigint AS amount FROM folio_lines
        WHERE property_id = ${propertyId}::uuid AND business_date = ${day} AND tax_code IS NOT NULL
        GROUP BY tax_code ORDER BY tax_code`;
      const payments = await tx.$queryRaw<{ method: string; amount: bigint; count: bigint }[]>`
        SELECT method::text AS method, sum(amount_minor)::bigint AS amount, count(*) AS count FROM payments
        WHERE property_id = ${propertyId}::uuid AND business_date = ${day}
        GROUP BY method ORDER BY method`;
      const refunds = await tx.$queryRaw<{ method: string; amount: bigint; count: bigint }[]>`
        SELECT p.method::text AS method, sum(r.amount_minor)::bigint AS amount, count(*) AS count
        FROM refunds r JOIN payments p ON p.id = r.payment_id
        JOIN folio_lines l ON l.id = r.folio_line_id
        WHERE r.property_id = ${propertyId}::uuid AND r.status = 'SUCCEEDED' AND l.business_date = ${day}
        GROUP BY p.method ORDER BY p.method`;
      const outstanding = await tx.folio.aggregate({
        where: { propertyId, status: 'OPEN' },
        _sum: { balanceMinor: true },
      });
      const sum = (rows: { amount?: bigint; net?: bigint }[]) =>
        rows.reduce((s, r) => s + (r.amount ?? r.net ?? 0n), 0n);
      return {
        businessDate,
        currency: property.currency,
        revenue: revenue.map((r) => ({ department: r.department, netMinor: signed(r.net) })),
        taxes: taxes.map((t) => ({ code: t.code, amountMinor: signed(t.amount) })),
        payments: payments.map((p) => ({
          method: p.method,
          amountMinor: signed(p.amount),
          count: Number(p.count),
        })),
        refunds: refunds.map((r) => ({
          method: r.method,
          amountMinor: signed(r.amount),
          count: Number(r.count),
        })),
        totals: {
          revenueNetMinor: signed(sum(revenue)),
          taxMinor: signed(sum(taxes)),
          paymentsMinor: signed(sum(payments)),
          refundsMinor: signed(sum(refunds)),
        },
        outstandingMinor: signed(outstanding._sum.balanceMinor ?? 0n),
      };
    });
  }

  async reconciliation(propertyId: string): Promise<Reconciliation> {
    return this.db.run(async (tx) => {
      const issues: Reconciliation['issues'] = [];
      const mismatches = await tx.$queryRaw<{ folio_no: string; cached: bigint; ledger: bigint }[]>`
        SELECT f.folio_no, f.balance_minor AS cached, coalesce(sum(l.amount_minor), 0)::bigint AS ledger
        FROM folios f LEFT JOIN folio_lines l ON l.folio_id = f.id
        WHERE f.property_id = ${propertyId}::uuid
        GROUP BY f.id HAVING f.balance_minor <> coalesce(sum(l.amount_minor), 0)`;
      for (const m of mismatches) {
        issues.push({
          code: 'FOLIO_BALANCE_MISMATCH',
          message: `Cached balance ${signed(m.cached)} differs from the ledger ${signed(m.ledger)}.`,
          reference: m.folio_no,
        });
      }
      const orphanPayments = await tx.$queryRaw<{ id: string }[]>`
        SELECT p.id::text FROM payments p
        LEFT JOIN folio_lines l ON l.id = p.folio_line_id AND l.type = 'PAYMENT' AND l.amount_minor = -p.amount_minor
        WHERE p.property_id = ${propertyId}::uuid AND l.id IS NULL`;
      for (const p of orphanPayments) {
        issues.push({
          code: 'PAYMENT_WITHOUT_LINE',
          message: 'Payment without a matching folio line.',
          reference: p.id,
        });
      }
      const intents = await tx.paymentIntent.findMany({
        where: {
          propertyId,
          OR: [
            { status: 'SUCCEEDED', needsAttention: true },
            { status: 'PENDING', expiresAt: { lt: new Date() } },
          ],
        },
        select: { id: true, status: true, failureReason: true },
      });
      for (const i of intents) {
        issues.push(
          i.status === 'SUCCEEDED'
            ? {
                code: 'UNAPPLIED_ONLINE_PAYMENT',
                message: i.failureReason ?? 'Paid online but not on a folio.',
                reference: i.id,
              }
            : {
                code: 'STALE_PAYMENT_INTENT',
                message: 'Checkout expired without a result from the provider.',
                reference: i.id,
              },
        );
      }
      const staleShifts = await tx.cashierShift.findMany({
        where: {
          propertyId,
          status: 'OPEN',
          openedAt: { lt: new Date(Date.now() - 24 * 3_600_000) },
        },
        select: { id: true },
      });
      for (const s of staleShifts) {
        issues.push({
          code: 'STALE_CASHIER_SHIFT',
          message: 'Cashier shift open for more than 24 hours.',
          reference: s.id,
        });
      }
      const pendingRefunds = await tx.refund.findMany({
        where: {
          propertyId,
          status: 'PENDING',
          createdAt: { lt: new Date(Date.now() - 3_600_000) },
        },
        select: { id: true },
      });
      for (const r of pendingRefunds) {
        issues.push({
          code: 'PENDING_REFUND',
          message: 'Refund pending at the provider for over an hour.',
          reference: r.id,
        });
      }
      return { ok: issues.length === 0, checkedAt: new Date().toISOString(), issues };
    });
  }
}
