import type { PrismaClient } from './generated/prisma/client.js';
import { withDbContext } from './context.js';

/** Demo inventory per property: room types, numbered rooms, one "BAR" rate plan. */
export interface DemoInventorySpec {
  currency: string;
  roomTypes: {
    code: string;
    name: string;
    base: number;
    max: number;
    price: number;
    rooms: string[];
  }[];
}

export interface DemoInventory {
  roomTypes: Record<string, string>;
  rooms: Record<string, string>;
  ratePlans: Record<string, string>;
}

export const DEMO_INVENTORY: Record<string, DemoInventorySpec> = {
  MNL: {
    currency: 'PHP',
    roomTypes: [
      {
        code: 'STD',
        name: 'Standard Queen',
        base: 2,
        max: 3,
        price: 350_000,
        rooms: ['101', '102', '103', '104'],
      },
      { code: 'DLX', name: 'Deluxe King', base: 2, max: 4, price: 550_000, rooms: ['201', '202'] },
    ],
  },
  CEB: {
    currency: 'PHP',
    roomTypes: [
      {
        code: 'STD',
        name: 'Garden Room',
        base: 2,
        max: 3,
        price: 420_000,
        rooms: ['101', '102', '103'],
      },
    ],
  },
  DVO: {
    currency: 'PHP',
    roomTypes: [
      {
        code: 'STD',
        name: 'Standard Twin',
        base: 2,
        max: 2,
        price: 300_000,
        rooms: ['101', '102'],
      },
    ],
  },
  BOR: {
    currency: 'PHP',
    roomTypes: [
      { code: 'VIL', name: 'Beach Villa', base: 2, max: 4, price: 1_200_000, rooms: ['V1', 'V2'] },
    ],
  },
};

/** Idempotent: does nothing if the property already has room types. */
export async function seedDemoInventory(
  prisma: PrismaClient,
  organizationId: string,
  propertyId: string,
  spec: DemoInventorySpec,
): Promise<DemoInventory> {
  return withDbContext(prisma, { organizationId, identityId: null }, async (tx) => {
    const result: DemoInventory = { roomTypes: {}, rooms: {}, ratePlans: {} };
    // Philippine VAT: 12%, included in quoted prices, on every department.
    if ((await tx.taxRule.count({ where: { propertyId } })) === 0) {
      await tx.taxRule.create({
        data: {
          organizationId,
          propertyId,
          code: 'VAT',
          name: 'VAT 12%',
          rateBps: 1200,
          inclusive: true,
          departments: ['ROOM', 'FNB', 'MINIBAR', 'LAUNDRY', 'TRANSPORT', 'SPA', 'MISC'],
        },
      });
    }
    // Philippine statutory discounts (RA 9994, RA 10754): 20% and VAT-exempt. Seed
    // configuration that each property can change, never code.
    if ((await tx.discountProfile.count({ where: { propertyId } })) === 0) {
      for (const [code, name] of [
        ['SENIOR', 'Senior citizen'],
        ['PWD', 'Person with disability'],
      ] as const) {
        await tx.discountProfile.create({
          data: {
            organizationId,
            propertyId,
            code,
            name,
            discountBps: 2000,
            exemptTaxCodes: ['VAT'],
            departments: ['ROOM', 'FNB'],
          },
        });
      }
    }
    const existing = await tx.roomType.findMany({
      where: { propertyId },
      include: { rooms: true },
    });
    if (existing.length > 0) {
      for (const rt of existing) {
        result.roomTypes[rt.code] = rt.id;
        for (const room of rt.rooms) result.rooms[room.number] = room.id;
      }
      for (const rp of await tx.ratePlan.findMany({ where: { propertyId } }))
        result.ratePlans[rp.code] = rp.id;
      return result;
    }

    const building = await tx.building.create({
      data: { organizationId, propertyId, code: 'MAIN', name: 'Main building' },
    });
    const floorIds = new Map<number, string>();
    const floorFor = async (roomNumber: string) => {
      const level = /^\d/.test(roomNumber) ? Number(roomNumber[0]) : 1;
      if (!floorIds.has(level)) {
        const floor = await tx.floor.create({
          data: {
            organizationId,
            propertyId,
            buildingId: building.id,
            level,
            name: `Floor ${level}`,
          },
        });
        floorIds.set(level, floor.id);
      }
      return floorIds.get(level)!;
    };

    const ratePlan = await tx.ratePlan.create({
      data: {
        organizationId,
        propertyId,
        code: 'BAR',
        name: 'Best Available Rate',
        cancellationPolicy: 'Free cancellation until 24 hours before arrival.',
        currency: spec.currency,
      },
    });
    result.ratePlans.BAR = ratePlan.id;

    for (const [index, type] of spec.roomTypes.entries()) {
      const roomType = await tx.roomType.create({
        data: {
          organizationId,
          propertyId,
          code: type.code,
          name: type.name,
          baseOccupancy: type.base,
          maxOccupancy: type.max,
          sortOrder: index,
        },
      });
      result.roomTypes[type.code] = roomType.id;
      await tx.ratePlanRoomType.create({
        data: {
          organizationId,
          ratePlanId: ratePlan.id,
          roomTypeId: roomType.id,
          baseAmountMinor: BigInt(type.price),
        },
      });
      for (const number of type.rooms) {
        const room = await tx.room.create({
          data: {
            organizationId,
            propertyId,
            roomTypeId: roomType.id,
            floorId: await floorFor(number),
            number,
          },
        });
        result.rooms[number] = room.id;
      }
    }
    return result;
  });
}
