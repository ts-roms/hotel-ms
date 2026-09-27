import { Injectable } from '@nestjs/common';
import type { CashierShift } from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { isUniqueViolation } from '../../common/db-errors.js';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { toMinor } from '../pms/pricing.js';
import { invalidState } from '../pms/reservations.service.js';

const shiftInclude = {
  membership: { select: { identity: { select: { displayName: true } } } },
} satisfies Prisma.CashierShiftInclude;

type ShiftRow = Prisma.CashierShiftGetPayload<{ include: typeof shiftInclude }>;

const signed = (v: bigint) => (v < 0n ? -toMinor(-v) : toMinor(v));

/**
 * Cashier shifts (blueprint §15.2): cash taken or refunded at the desk belongs to the
 * cashier's open shift; closing it compares the counted drawer with float + cash in −
 * cash out.
 */
@Injectable()
export class CashierService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private async totals(tx: Tx, shiftId: string): Promise<{ cashIn: bigint; cashOut: bigint }> {
    const cashIn = await tx.payment.aggregate({
      where: { cashierShiftId: shiftId, method: 'CASH' },
      _sum: { amountMinor: true },
    });
    const cashOut = await tx.refund.aggregate({
      where: { cashierShiftId: shiftId, status: 'SUCCEEDED' },
      _sum: { amountMinor: true },
    });
    return { cashIn: cashIn._sum.amountMinor ?? 0n, cashOut: cashOut._sum.amountMinor ?? 0n };
  }

  private async toDto(tx: Tx, s: ShiftRow): Promise<CashierShift> {
    const { cashIn, cashOut } = await this.totals(tx, s.id);
    const expected = s.expectedCashMinor ?? s.openingFloatMinor + cashIn - cashOut;
    return {
      id: s.id,
      cashierName: s.membership.identity.displayName,
      status: s.status,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      openingFloatMinor: toMinor(s.openingFloatMinor),
      cashInMinor: toMinor(cashIn),
      cashOutMinor: toMinor(cashOut),
      expectedCashMinor: signed(expected),
      countedCashMinor: s.countedCashMinor === null ? null : toMinor(s.countedCashMinor),
      varianceMinor: s.varianceMinor === null ? null : signed(s.varianceMinor),
      notes: s.notes,
      version: s.version,
    };
  }

  private get membershipId(): string {
    const id = this.cls.get('membershipId');
    if (!id) throw Problems.forbidden('Only staff members have cashier shifts.');
    return id;
  }

  async current(propertyId: string): Promise<CashierShift | null> {
    return this.db.run(async (tx) => {
      const shift = await tx.cashierShift.findFirst({
        where: { membershipId: this.membershipId, propertyId, status: 'OPEN' },
        include: shiftInclude,
      });
      return shift ? this.toDto(tx, shift) : null;
    });
  }

  async open(propertyId: string, openingFloatMinor: number): Promise<CashierShift> {
    try {
      return await this.db.run(async (tx) => {
        const shift = await tx.cashierShift.create({
          data: {
            organizationId: this.cls.get('organizationId')!,
            propertyId,
            membershipId: this.membershipId,
            openingFloatMinor: BigInt(openingFloatMinor),
          },
          include: shiftInclude,
        });
        await this.audit.record(tx, {
          action: 'cashier.shift_opened',
          entityType: 'cashier_shift',
          entityId: shift.id,
          propertyId,
          after: { openingFloatMinor },
        });
        return this.toDto(tx, shift);
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw invalidState('You already have an open cashier shift here.');
      throw error;
    }
  }

  /** Only the cashier closes their own drawer. */
  async close(
    propertyId: string,
    id: string,
    expectedVersion: number,
    countedCashMinor: number,
    notes: string,
  ): Promise<CashierShift> {
    return this.db.run(async (tx) => {
      const shift = await tx.cashierShift.findFirst({ where: { id, propertyId } });
      if (!shift) throw Problems.notFound('Cashier shift');
      if (shift.membershipId !== this.membershipId)
        throw Problems.forbidden('Close your own shift only.');
      if (shift.status !== 'OPEN') throw invalidState('The shift is already closed.');
      const { cashIn, cashOut } = await this.totals(tx, id);
      const expected = shift.openingFloatMinor + cashIn - cashOut;
      const counted = BigInt(countedCashMinor);
      const { count } = await tx.cashierShift.updateMany({
        where: { id, version: expectedVersion, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          expectedCashMinor: expected,
          countedCashMinor: counted,
          varianceMinor: counted - expected,
          notes,
          version: { increment: 1 },
        },
      });
      if (count !== 1) throw Problems.versionConflict();
      await this.audit.record(tx, {
        action: 'cashier.shift_closed',
        entityType: 'cashier_shift',
        entityId: id,
        propertyId,
        after: {
          expectedCashMinor: signed(expected),
          countedCashMinor,
          varianceMinor: signed(counted - expected),
        },
      });
      await this.outbox.enqueue(
        tx,
        'CashierShiftClosed',
        { shiftId: id, varianceMinor: signed(counted - expected) },
        { propertyId },
      );
      return this.toDto(
        tx,
        await tx.cashierShift.findUniqueOrThrow({ where: { id }, include: shiftInclude }),
      );
    });
  }

  async list(propertyId: string): Promise<CashierShift[]> {
    return this.db.run(async (tx) => {
      const rows = await tx.cashierShift.findMany({
        where: { propertyId },
        include: shiftInclude,
        orderBy: { openedAt: 'desc' },
        take: 50,
      });
      const shifts: CashierShift[] = [];
      for (const row of rows) shifts.push(await this.toDto(tx, row));
      return shifts;
    });
  }
}
