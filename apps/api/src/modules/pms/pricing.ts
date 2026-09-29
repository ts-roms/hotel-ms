import type { Tx } from '@hotel/database';
import { fromDbDate, toDbDate } from '../../common/dates.js';
import { Problems } from '../../common/problem.js';

export interface NightPrice {
  date: string;
  amountMinor: bigint;
}

/**
 * Nightly prices for a room type under a rate plan: a per-date override if set, otherwise
 * the plan's base price. Throws 400 if the plan does not sell this room type.
 */
export async function priceStay(
  tx: Tx,
  ratePlanId: string,
  roomTypeId: string,
  nights: string[],
): Promise<{ currency: string; nights: NightPrice[] }> {
  const plan = await tx.ratePlan.findUnique({
    where: { id: ratePlanId },
    include: { roomTypePrices: { where: { roomTypeId } } },
  });
  if (!plan || plan.archivedAt)
    throw Problems.validation([{ path: 'ratePlanId', message: 'Unknown rate plan' }]);
  const base = plan.roomTypePrices[0];
  if (!base) {
    throw Problems.validation([
      { path: 'ratePlanId', message: 'This rate plan has no price for the room type' },
    ]);
  }
  const overrides = nights.length
    ? await tx.rateOverride.findMany({
        where: {
          ratePlanId,
          roomTypeId,
          stayDate: { gte: toDbDate(nights[0]!), lte: toDbDate(nights.at(-1)!) },
        },
      })
    : [];
  const byDate = new Map(overrides.map((o) => [fromDbDate(o.stayDate), o.amountMinor]));
  return {
    currency: plan.currency,
    nights: nights.map((date) => ({ date, amountMinor: byDate.get(date) ?? base.baseAmountMinor })),
  };
}
