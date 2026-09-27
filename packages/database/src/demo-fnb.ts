import type { PrismaClient } from './generated/prisma/client.js';
import { withDbContext } from './context.js';

export interface DemoFnb {
  /** Outlet code → id */
  outlets: Record<string, string>;
  /** Item name → id */
  items: Record<string, string>;
  /** Modifier name → id */
  modifiers: Record<string, string>;
}

interface ItemSpec {
  name: string;
  price: number;
  description?: string;
  groups?: { name: string; min: number; max: number; modifiers: [string, number][] }[];
}

const ROOM_SERVICE_MENU: { category: string; items: ItemSpec[] }[] = [
  {
    category: 'Breakfast',
    items: [
      { name: 'Tapsilog', price: 45_000, description: 'Beef tapa, garlic rice, fried egg' },
      { name: 'Continental Breakfast', price: 38_000 },
    ],
  },
  {
    category: 'Mains',
    items: [
      { name: 'Chicken Adobo', price: 52_000, description: 'With steamed rice' },
      {
        name: 'Club Sandwich',
        price: 42_000,
        groups: [
          {
            name: 'Side',
            min: 1,
            max: 1,
            modifiers: [
              ['Fries', 0],
              ['Salad', 0],
              ['Sweet potato fries', 5_000],
            ],
          },
          {
            name: 'Extras',
            min: 0,
            max: 2,
            modifiers: [
              ['Extra bacon', 8_000],
              ['Cheese', 4_000],
            ],
          },
        ],
      },
    ],
  },
  {
    category: 'Drinks',
    items: [
      { name: 'Iced Tea', price: 12_000 },
      { name: 'San Miguel Beer', price: 18_000 },
    ],
  },
];

/**
 * Demo outlets for one property: a 24-hour in-room dining outlet (guest ordering) and a
 * café with opening hours. Skips properties that already have outlets.
 */
export async function seedDemoFnb(
  prisma: PrismaClient,
  organizationId: string,
  propertyId: string,
): Promise<DemoFnb | null> {
  return withDbContext(prisma, { organizationId, identityId: null }, async (tx) => {
    if ((await tx.outlet.count({ where: { propertyId } })) > 0) return null;
    const fnb: DemoFnb = { outlets: {}, items: {}, modifiers: {} };
    const ird = await tx.outlet.create({
      data: {
        organizationId,
        propertyId,
        code: 'IRD',
        name: 'In-Room Dining',
        type: 'ROOM_SERVICE',
        roomService: true,
      },
    });
    const cafe = await tx.outlet.create({
      data: {
        organizationId,
        propertyId,
        code: 'CAFE',
        name: 'Lobby Café',
        type: 'CAFE',
        allowRoomCharge: true,
        opensAt: '06:00',
        closesAt: '22:00',
      },
    });
    fnb.outlets.IRD = ird.id;
    fnb.outlets.CAFE = cafe.id;

    for (const [outletId, menu] of [
      [ird.id, ROOM_SERVICE_MENU],
      [cafe.id, ROOM_SERVICE_MENU.slice(2)],
    ] as const) {
      for (const [ci, section] of menu.entries()) {
        const category = await tx.menuCategory.create({
          data: { organizationId, outletId, name: section.category, sortOrder: ci },
        });
        for (const [ii, spec] of section.items.entries()) {
          const item = await tx.menuItem.create({
            data: {
              organizationId,
              outletId,
              categoryId: category.id,
              name: spec.name,
              description: spec.description ?? '',
              priceMinor: BigInt(spec.price),
              sortOrder: ii,
            },
          });
          if (outletId === ird.id) fnb.items[spec.name] = item.id;
          for (const [gi, g] of (spec.groups ?? []).entries()) {
            const group = await tx.modifierGroup.create({
              data: {
                organizationId,
                menuItemId: item.id,
                name: g.name,
                minSelect: g.min,
                maxSelect: g.max,
                sortOrder: gi,
              },
            });
            for (const [mi, [modifierName, modifierPrice]] of g.modifiers.entries()) {
              const modifier = await tx.modifier.create({
                data: {
                  organizationId,
                  groupId: group.id,
                  name: modifierName,
                  priceMinor: BigInt(modifierPrice),
                  sortOrder: mi,
                },
              });
              if (outletId === ird.id) fnb.modifiers[modifierName] = modifier.id;
            }
          }
        }
      }
    }
    return fnb;
  });
}
