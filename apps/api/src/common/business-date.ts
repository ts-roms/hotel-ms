import type { Tx } from '@hotel/database';
import { fromDbDate } from './dates.js';

/**
 * The property's current business date (ADR-0008), read in the caller's transaction.
 * Every context that posts or stamps business-day data needs it; the night audit, which
 * owns it, is the only writer (ADR-0031).
 */
export async function businessDateOf(tx: Tx, propertyId: string): Promise<string> {
  const property = await tx.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: { currentBusinessDate: true },
  });
  return fromDbDate(property.currentBusinessDate);
}
