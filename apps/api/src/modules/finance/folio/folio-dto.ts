import type { Folio } from '@hotel/contracts';
import type { Prisma } from '@hotel/database';
import { fromDbDate } from '../../../common/dates.js';
import { formatRate, toMinor } from '../../../common/money.js';

export const folioInclude = {
  lines: { orderBy: [{ postedAt: 'asc' }, { id: 'asc' }] },
  payments: {
    orderBy: { createdAt: 'asc' },
    include: { refunds: { select: { amountMinor: true, status: true } } },
  },
  discountProfile: { select: { id: true, code: true, name: true } },
} satisfies Prisma.FolioInclude;

type FolioRow = Prisma.FolioGetPayload<{ include: typeof folioInclude }>;

export function toFolioDto(folio: FolioRow): Folio {
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

/** Signed minor units (a folio balance or line may be negative). */
export function toSignedMinor(value: bigint): number {
  return value < 0n ? -toMinor(-value) : toMinor(value);
}
