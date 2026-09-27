import { Prisma, type Tx } from '@hotel/database';
import { rethrowConstraintError } from '../../common/db-errors.js';
import { ProblemException } from '../../common/problem.js';

/**
 * Sellable inventory operations (blueprint §12.3). Every function takes the caller's
 * transaction: inventory moves commit or roll back together with the booking change.
 *
 * Locking: rows are locked with SELECT ... FOR UPDATE ordered by (room type, date) before
 * being changed, so two transactions touching overlapping nights always lock in the same
 * order and cannot deadlock.
 */
export type InventoryColumn = 'sold' | 'blocked';

export interface InventoryDemand {
  roomTypeId: string;
  dates: string[];
}

const noAvailability = (detail: string) =>
  new ProblemException(409, 'NO_AVAILABILITY', 'No availability', detail);

/** Creates missing night rows with capacity = active rooms of the type. */
async function ensureNights(
  tx: Tx,
  organizationId: string,
  propertyId: string,
  demand: InventoryDemand,
): Promise<void> {
  if (demand.dates.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO inventory_nights (organization_id, property_id, room_type_id, stay_date, capacity, updated_at)
    SELECT ${organizationId}::uuid, ${propertyId}::uuid, ${demand.roomTypeId}::uuid, d::date,
           (SELECT count(*) FROM rooms r WHERE r.room_type_id = ${demand.roomTypeId}::uuid AND r.archived_at IS NULL),
           now()
    FROM unnest(${demand.dates}::text[]) AS d
    ON CONFLICT (room_type_id, stay_date) DO NOTHING`;
}

function sortDemands(demands: InventoryDemand[]): InventoryDemand[] {
  // Merge per room type (two rooms of one type take 2 per night) and order globally.
  const byType = new Map<string, string[]>();
  for (const d of demands)
    byType.set(d.roomTypeId, [...(byType.get(d.roomTypeId) ?? []), ...d.dates]);
  return [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([roomTypeId, dates]) => ({ roomTypeId, dates: dates.sort() }));
}

async function lockNights(tx: Tx, roomTypeId: string, dates: string[]): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 FROM inventory_nights
    WHERE room_type_id = ${roomTypeId}::uuid AND stay_date = ANY(${[...new Set(dates)]}::date[])
    ORDER BY stay_date
    FOR UPDATE`;
}

/**
 * Takes one unit per listed night (a date listed twice takes two). Throws 409
 * NO_AVAILABILITY if any night is full; the caller's transaction then rolls back.
 */
export async function takeInventory(
  tx: Tx,
  organizationId: string,
  propertyId: string,
  demands: InventoryDemand[],
  column: InventoryColumn = 'sold',
): Promise<void> {
  for (const demand of sortDemands(demands)) {
    await ensureNights(tx, organizationId, propertyId, demand);
    await lockNights(tx, demand.roomTypeId, demand.dates);
    const counts = new Map<string, number>();
    for (const date of demand.dates) counts.set(date, (counts.get(date) ?? 0) + 1);
    for (const [date, units] of counts) {
      const updated = await tx.$executeRaw`
        UPDATE inventory_nights
        SET ${Prisma.raw(column)} = ${Prisma.raw(column)} + ${units}, updated_at = now()
        WHERE room_type_id = ${demand.roomTypeId}::uuid AND stay_date = ${date}::date
          AND sold + blocked + ${units} <= capacity + overbooking_limit`;
      if (updated !== 1) throw noAvailability(`Sold out on ${date}.`);
    }
  }
}

export async function releaseInventory(
  tx: Tx,
  demands: InventoryDemand[],
  column: InventoryColumn = 'sold',
): Promise<void> {
  for (const demand of sortDemands(demands)) {
    await lockNights(tx, demand.roomTypeId, demand.dates);
    const counts = new Map<string, number>();
    for (const date of demand.dates) counts.set(date, (counts.get(date) ?? 0) + 1);
    for (const [date, units] of counts) {
      await tx.$executeRaw`
        UPDATE inventory_nights
        SET ${Prisma.raw(column)} = ${Prisma.raw(column)} - ${units}, updated_at = now()
        WHERE room_type_id = ${demand.roomTypeId}::uuid AND stay_date = ${date}::date`;
    }
  }
}

/**
 * After rooms are added, archived or moved between types: refresh capacity for dates
 * from `fromDate`. Fails with NO_AVAILABILITY if a night would become oversold.
 */
export async function refreshCapacity(tx: Tx, roomTypeId: string, fromDate: string): Promise<void> {
  try {
    await tx.$executeRaw`
      UPDATE inventory_nights
      SET capacity = (SELECT count(*) FROM rooms r WHERE r.room_type_id = ${roomTypeId}::uuid AND r.archived_at IS NULL),
          updated_at = now()
      WHERE room_type_id = ${roomTypeId}::uuid AND stay_date >= ${fromDate}::date`;
  } catch (error) {
    rethrowConstraintError(error);
  }
}

export interface InventoryRow {
  roomTypeId: string;
  date: string;
  capacity: number;
  sold: number;
  blocked: number;
}

/** Reads availability; nights without a row are fully available at current capacity. */
export async function readInventory(
  tx: Tx,
  roomTypes: { id: string; activeRooms: number }[],
  dates: string[],
): Promise<InventoryRow[]> {
  const rows = await tx.inventoryNight.findMany({
    where: {
      roomTypeId: { in: roomTypes.map((r) => r.id) },
      stayDate: {
        gte: new Date(`${dates[0]}T00:00:00Z`),
        lte: new Date(`${dates.at(-1)}T00:00:00Z`),
      },
    },
  });
  const key = (roomTypeId: string, date: string) => `${roomTypeId}|${date}`;
  const found = new Map(
    rows.map((r) => [key(r.roomTypeId, r.stayDate.toISOString().slice(0, 10)), r]),
  );
  const result: InventoryRow[] = [];
  for (const rt of roomTypes) {
    for (const date of dates) {
      const row = found.get(key(rt.id, date));
      result.push({
        roomTypeId: rt.id,
        date,
        capacity: row?.capacity ?? rt.activeRooms,
        sold: row?.sold ?? 0,
        blocked: row?.blocked ?? 0,
      });
    }
  }
  return result;
}
