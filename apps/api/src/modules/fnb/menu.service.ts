import { Injectable } from '@nestjs/common';
import type {
  CreateCategoryRequest,
  CreateMenuItemRequest,
  CreateOutletRequest,
  Menu,
  MenuItem,
  Outlet,
  UpdateMenuItemRequest,
  UpdateOutletRequest,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { isUniqueViolation, withConstraintMapping } from '../../common/db-errors.js';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { toLocal } from '../../common/zoned-time.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { toMinor } from '../pms/pricing.js';

type OutletRow = Prisma.OutletGetPayload<object>;

export function toOutletDto(o: OutletRow): Outlet {
  return {
    id: o.id,
    code: o.code,
    name: o.name,
    type: o.type,
    roomService: o.roomService,
    allowRoomCharge: o.allowRoomCharge,
    opensAt: o.opensAt,
    closesAt: o.closesAt,
    active: o.active,
    version: o.version,
  };
}

/** Open now in property-local time; hours that end before they start wrap midnight. */
export function isOpen(
  outlet: { active: boolean; opensAt: string | null; closesAt: string | null },
  timeZone: string,
  now = new Date(),
): boolean {
  if (!outlet.active) return false;
  if (!outlet.opensAt || !outlet.closesAt) return true;
  const time = toLocal(now, timeZone).time;
  return outlet.opensAt <= outlet.closesAt
    ? time >= outlet.opensAt && time < outlet.closesAt
    : time >= outlet.opensAt || time < outlet.closesAt;
}

const itemInclude = {
  modifierGroups: {
    orderBy: { sortOrder: 'asc' },
    include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
  },
} satisfies Prisma.MenuItemInclude;

type ItemRow = Prisma.MenuItemGetPayload<{ include: typeof itemInclude }>;

function toItemDto(i: ItemRow): MenuItem {
  return {
    id: i.id,
    categoryId: i.categoryId,
    name: i.name,
    description: i.description,
    priceMinor: toMinor(i.priceMinor),
    available: i.available,
    archived: i.archivedAt !== null,
    modifierGroups: i.modifierGroups.map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      modifiers: g.modifiers.map((m) => ({
        id: m.id,
        name: m.name,
        priceMinor: toMinor(m.priceMinor),
      })),
    })),
  };
}

@Injectable()
export class MenuService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private get organizationId() {
    return this.cls.get('organizationId')!;
  }

  async requireOutlet(tx: Tx, propertyId: string, outletId: string): Promise<OutletRow> {
    const outlet = await tx.outlet.findFirst({ where: { id: outletId, propertyId } });
    if (!outlet) throw Problems.notFound('Outlet');
    return outlet;
  }

  // ---- Outlets -----------------------------------------------------------------------------

  async outlets(propertyId: string): Promise<Outlet[]> {
    const rows = await this.db.run((tx) =>
      tx.outlet.findMany({ where: { propertyId }, orderBy: { name: 'asc' } }),
    );
    return rows.map(toOutletDto);
  }

  async createOutlet(propertyId: string, input: CreateOutletRequest): Promise<Outlet> {
    try {
      return await this.db.run(async (tx) => {
        const row = await tx.outlet.create({
          data: { organizationId: this.organizationId, propertyId, ...input },
        });
        await this.audit.record(tx, {
          action: 'outlet.created',
          entityType: 'outlet',
          entityId: row.id,
          propertyId,
          after: input,
        });
        return toOutletDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw Problems.conflict(`Outlet code ${input.code} is in use.`);
      throw error;
    }
  }

  async updateOutlet(
    propertyId: string,
    outletId: string,
    expectedVersion: number,
    input: UpdateOutletRequest,
  ): Promise<Outlet> {
    // Both-or-neither opening hours are enforced by the outlets_hours constraint.
    return withConstraintMapping(() =>
      this.db.run(async (tx) => {
        const current = await this.requireOutlet(tx, propertyId, outletId);
        const { count } = await tx.outlet.updateMany({
          where: { id: outletId, version: expectedVersion },
          data: { ...input, version: { increment: 1 } },
        });
        if (count !== 1) throw Problems.versionConflict();
        const row = await tx.outlet.findUniqueOrThrow({ where: { id: outletId } });
        await this.audit.record(tx, {
          action: 'outlet.updated',
          entityType: 'outlet',
          entityId: outletId,
          propertyId,
          before: toOutletDto(current),
          after: toOutletDto(row),
        });
        return toOutletDto(row);
      }),
    );
  }

  // ---- Menu --------------------------------------------------------------------------------

  async menuInTx(tx: Tx, outlet: OutletRow, options: { forGuest: boolean }): Promise<Menu> {
    const property = await tx.property.findUniqueOrThrow({
      where: { id: outlet.propertyId },
      select: { currency: true, timezone: true },
    });
    const categories = await tx.menuCategory.findMany({
      where: { outletId: outlet.id, archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        items: {
          where: { archivedAt: null, ...(options.forGuest ? { available: true } : {}) },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: itemInclude,
        },
      },
    });
    return {
      outlet: toOutletDto(outlet),
      currency: property.currency,
      open: isOpen(outlet, property.timezone),
      categories: categories
        .filter((c) => !options.forGuest || c.items.length > 0)
        .map((c) => ({
          id: c.id,
          name: c.name,
          sortOrder: c.sortOrder,
          items: c.items.map(toItemDto),
        })),
    };
  }

  async menu(propertyId: string, outletId: string): Promise<Menu> {
    return this.db.run(async (tx) =>
      this.menuInTx(tx, await this.requireOutlet(tx, propertyId, outletId), { forGuest: false }),
    );
  }

  async createCategory(
    propertyId: string,
    outletId: string,
    input: CreateCategoryRequest,
  ): Promise<Menu> {
    return this.db.run(async (tx) => {
      const outlet = await this.requireOutlet(tx, propertyId, outletId);
      const row = await tx.menuCategory.create({
        data: { organizationId: this.organizationId, outletId, ...input },
      });
      await this.audit.record(tx, {
        action: 'menu.category_created',
        entityType: 'menu_category',
        entityId: row.id,
        propertyId,
        after: input,
      });
      return this.menuInTx(tx, outlet, { forGuest: false });
    });
  }

  async createItem(
    propertyId: string,
    outletId: string,
    input: CreateMenuItemRequest,
  ): Promise<MenuItem> {
    return this.db.run(async (tx) => {
      await this.requireOutlet(tx, propertyId, outletId);
      const category = await tx.menuCategory.findFirst({
        where: { id: input.categoryId, outletId, archivedAt: null },
      });
      if (!category)
        throw Problems.validation([{ path: 'categoryId', message: 'Unknown category' }]);
      const organizationId = this.organizationId;
      const item = await tx.menuItem.create({
        data: {
          organizationId,
          outletId,
          categoryId: category.id,
          name: input.name,
          description: input.description,
          priceMinor: BigInt(input.priceMinor),
        },
      });
      for (const [gi, g] of input.modifierGroups.entries()) {
        const group = await tx.modifierGroup.create({
          data: {
            organizationId,
            menuItemId: item.id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            sortOrder: gi,
          },
        });
        for (const [mi, m] of g.modifiers.entries()) {
          await tx.modifier.create({
            data: {
              organizationId,
              groupId: group.id,
              name: m.name,
              priceMinor: BigInt(m.priceMinor),
              sortOrder: mi,
            },
          });
        }
      }
      await this.audit.record(tx, {
        action: 'menu.item_created',
        entityType: 'menu_item',
        entityId: item.id,
        propertyId,
        after: { name: input.name, priceMinor: input.priceMinor },
      });
      return toItemDto(
        await tx.menuItem.findUniqueOrThrow({ where: { id: item.id }, include: itemInclude }),
      );
    });
  }

  private async requireItem(tx: Tx, propertyId: string, itemId: string) {
    const item = await tx.menuItem.findFirst({ where: { id: itemId, outlet: { propertyId } } });
    if (!item) throw Problems.notFound('Menu item');
    return item;
  }

  async updateItem(
    propertyId: string,
    itemId: string,
    input: UpdateMenuItemRequest,
  ): Promise<MenuItem> {
    return this.db.run(async (tx) => {
      const current = await this.requireItem(tx, propertyId, itemId);
      const { archived, priceMinor, ...fields } = input;
      const row = await tx.menuItem.update({
        where: { id: itemId },
        data: {
          ...fields,
          ...(priceMinor !== undefined ? { priceMinor: BigInt(priceMinor) } : {}),
          ...(archived !== undefined
            ? { archivedAt: archived ? (current.archivedAt ?? new Date()) : null }
            : {}),
          version: { increment: 1 },
        },
        include: itemInclude,
      });
      await this.audit.record(tx, {
        action: 'menu.item_updated',
        entityType: 'menu_item',
        entityId: itemId,
        propertyId,
        before: {
          name: current.name,
          priceMinor: toMinor(current.priceMinor),
          available: current.available,
        },
        after: input,
      });
      return toItemDto(row);
    });
  }

  /** The kitchen's quick sold-out toggle ("86"). */
  async setAvailability(propertyId: string, itemId: string, available: boolean): Promise<MenuItem> {
    return this.db.run(async (tx) => {
      await this.requireItem(tx, propertyId, itemId);
      const row = await tx.menuItem.update({
        where: { id: itemId },
        data: { available, version: { increment: 1 } },
        include: itemInclude,
      });
      await this.audit.record(tx, {
        action: available ? 'menu.item_available' : 'menu.item_sold_out',
        entityType: 'menu_item',
        entityId: itemId,
        propertyId,
      });
      return toItemDto(row);
    });
  }
}
