import { Injectable } from '@nestjs/common';
import {
  type GuestOrderRequest,
  type Menu,
  ORDER_TRANSITIONS,
  type Order,
  type OrderItemInput,
  type OrderListQuery,
  type OrderStatus,
  type StaffOrderRequest,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { actorOf } from '../../common/actor.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { RealtimeService } from '../../infrastructure/realtime.js';
import { AuditService } from '../audit/audit.service.js';
import { FolioService } from '../folio/folio.service.js';
import { computeTaxes, type TaxRuleInput } from '../folio/tax-engine.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { toMinor } from '../pms/pricing.js';
import { invalidState, nextNumber } from '../pms/reservations.service.js';
import { isOpen, MenuService } from './menu.service.js';

const DEPARTMENT = 'FNB';
/** Statuses the kitchen board shows. */
const ACTIVE: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'];
/** Cancelling from these needs fnb.order.cancel_override (food is being made or served). */
const LATE: OrderStatus[] = ['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'];

const outletClosed = () =>
  new ProblemException(
    409,
    'OUTLET_CLOSED',
    'Outlet closed',
    'This outlet is not taking orders now.',
  );
const itemUnavailable = (name: string) =>
  new ProblemException(
    409,
    'ITEM_UNAVAILABLE',
    'Item unavailable',
    `${name} is not available right now.`,
  );

const orderInclude = {
  outlet: { select: { name: true } },
  room: { select: { number: true } },
  guest: { select: { firstName: true, lastName: true } },
  items: { orderBy: { id: 'asc' } },
  events: { orderBy: { at: 'asc' } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

function toOrderDto(o: OrderRow): Order {
  return {
    id: o.id,
    orderNo: o.orderNo,
    outletId: o.outletId,
    outletName: o.outlet.name,
    source: o.source,
    status: o.status,
    chargeMethod: o.chargeMethod,
    roomNumber: o.room?.number ?? null,
    guestName: o.guest ? `${o.guest.firstName} ${o.guest.lastName}` : null,
    items: o.items.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      name: i.name,
      quantity: i.quantity,
      unitPriceMinor: toMinor(i.unitPriceMinor),
      modifiers: i.modifiers as { name: string; priceMinor: number }[],
      lineTotalMinor: toMinor(i.lineTotalMinor),
      notes: i.notes,
    })),
    currency: o.currency,
    subtotalMinor: toMinor(o.subtotalMinor),
    addedTaxMinor: toMinor(o.addedTaxMinor),
    totalMinor: toMinor(o.totalMinor),
    notes: o.notes,
    charged: o.folioLineId !== null,
    cancelReason: o.cancelReason,
    createdAt: o.createdAt.toISOString(),
    events: o.events.map((e) => ({ status: e.toStatus, at: e.at.toISOString() })),
    version: o.version,
  };
}

interface PricedLine {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPriceMinor: bigint;
  modifiers: { name: string; priceMinor: number }[];
  lineTotalMinor: bigint;
  notes: string;
}

/**
 * Orders (blueprint §14). Prices and tax rules are copied onto the order when it is placed;
 * a room charge is posted to the stay's folio once, on delivery, keyed `order:{id}`.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: TenantDb,
    private readonly menus: MenuService,
    private readonly folios: FolioService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimeService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private get organizationId() {
    return this.cls.get('organizationId')!;
  }

  /** Validates items and modifiers against the live menu and prices them. */
  private async price(tx: Tx, outletId: string, inputs: OrderItemInput[]): Promise<PricedLine[]> {
    const lines: PricedLine[] = [];
    for (const input of inputs) {
      const item = await tx.menuItem.findFirst({
        where: { id: input.menuItemId, outletId, archivedAt: null },
        include: { modifierGroups: { include: { modifiers: true } } },
      });
      if (!item) throw Problems.validation([{ path: 'items', message: 'Unknown menu item' }]);
      if (!item.available) throw itemUnavailable(item.name);
      const chosen = new Set(input.modifierIds);
      const modifiers: { name: string; priceMinor: bigint }[] = [];
      for (const group of item.modifierGroups) {
        const picked = group.modifiers.filter((m) => chosen.has(m.id));
        if (picked.length < group.minSelect || picked.length > group.maxSelect) {
          throw Problems.validation([
            {
              path: 'items',
              message:
                group.minSelect === group.maxSelect
                  ? `${item.name}: choose ${group.minSelect} ${group.name.toLowerCase()}`
                  : `${item.name}: choose ${group.minSelect}–${group.maxSelect} ${group.name.toLowerCase()}`,
            },
          ]);
        }
        for (const m of picked) {
          chosen.delete(m.id);
          modifiers.push({ name: m.name, priceMinor: m.priceMinor });
        }
      }
      if (chosen.size > 0) {
        throw Problems.validation([{ path: 'items', message: `${item.name}: unknown option` }]);
      }
      const unit = item.priceMinor + modifiers.reduce((sum, m) => sum + m.priceMinor, 0n);
      lines.push({
        menuItemId: item.id,
        name: item.name,
        quantity: input.quantity,
        unitPriceMinor: unit,
        modifiers: modifiers.map((m) => ({ name: m.name, priceMinor: toMinor(m.priceMinor) })),
        lineTotalMinor: unit * BigInt(input.quantity),
        notes: input.notes,
      });
    }
    return lines;
  }

  private async create(
    tx: Tx,
    input: {
      propertyId: string;
      outlet: { id: string };
      source: 'GUEST' | 'STAFF';
      status: 'PENDING' | 'CONFIRMED';
      chargeMethod: Order['chargeMethod'];
      roomId: string | null;
      reservationRoomId: string | null;
      guestId: string | null;
      items: OrderItemInput[];
      notes: string;
    },
  ): Promise<OrderRow> {
    const organizationId = this.organizationId;
    const lines = await this.price(tx, input.outlet.id, input.items);
    const property = await tx.property.findUniqueOrThrow({
      where: { id: input.propertyId },
      select: { currency: true },
    });
    const taxRules = await this.folios.taxRulesFor(tx, input.propertyId, DEPARTMENT);
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotalMinor, 0n);
    const breakdown = computeTaxes(subtotal, taxRules);
    const n = await nextNumber(tx, organizationId, input.propertyId, 'order');
    const created = await tx.order.create({
      data: {
        organizationId,
        propertyId: input.propertyId,
        outletId: input.outlet.id,
        orderNo: `F-${String(n).padStart(6, '0')}`,
        source: input.source,
        status: input.status,
        chargeMethod: input.chargeMethod,
        roomId: input.roomId,
        reservationRoomId: input.reservationRoomId,
        guestId: input.guestId,
        currency: property.currency,
        subtotalMinor: subtotal,
        addedTaxMinor: breakdown.totalMinor - subtotal,
        totalMinor: breakdown.totalMinor,
        taxRules: taxRules as unknown as Prisma.InputJsonValue,
        notes: input.notes,
        createdBy: this.cls.get('identityId') ?? null,
      },
    });
    await tx.orderItem.createMany({
      data: lines.map((l) => ({ organizationId, orderId: created.id, ...l })),
    });
    await tx.orderEvent.create({
      data: { organizationId, orderId: created.id, toStatus: input.status, ...actorOf(this.cls) },
    });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: created.id },
      include: orderInclude,
    });
    await this.audit.record(tx, {
      action: 'order.placed',
      entityType: 'order',
      entityId: order.id,
      propertyId: input.propertyId,
      after: {
        orderNo: order.orderNo,
        totalMinor: toMinor(order.totalMinor),
        chargeMethod: order.chargeMethod,
      },
    });
    await this.outbox.enqueue(
      tx,
      'OrderPlaced',
      { orderId: order.id, outletId: order.outletId, source: input.source },
      { propertyId: input.propertyId },
    );
    return order;
  }

  private async notify(order: { id: string; outletId: string; status: string }): Promise<void> {
    await this.realtime.publish(
      RealtimeService.channel(this.organizationId, `fnb:outlet:${order.outletId}`),
      { type: 'order', orderId: order.id, status: order.status },
    );
  }

  // ---- Staff -------------------------------------------------------------------------------

  async staffPlace(propertyId: string, input: StaffOrderRequest): Promise<Order> {
    const order = await this.db.run(async (tx) => {
      const outlet = await this.menus.requireOutlet(tx, propertyId, input.outletId);
      if (!outlet.active) throw outletClosed();
      if (input.chargeMethod === 'ROOM_CHARGE' && !outlet.allowRoomCharge) {
        throw Problems.validation([
          { path: 'chargeMethod', message: 'This outlet does not take room charges' },
        ]);
      }
      let stay: { reservationRoomId: string; guestId: string } | null = null;
      if (input.roomId) {
        const room = await tx.room.findFirst({ where: { id: input.roomId, propertyId } });
        if (!room) throw Problems.validation([{ path: 'roomId', message: 'Unknown room' }]);
        const current = await tx.stay.findFirst({
          where: { roomId: room.id, checkedOutAt: null },
          include: { reservationRoom: { select: { id: true, guestId: true } } },
        });
        stay = current
          ? {
              reservationRoomId: current.reservationRoom.id,
              guestId: current.reservationRoom.guestId,
            }
          : null;
        if (!stay && input.chargeMethod === 'ROOM_CHARGE') {
          throw invalidState('Nobody is checked in to that room.');
        }
      }
      return this.create(tx, {
        propertyId,
        outlet,
        source: 'STAFF',
        status: 'CONFIRMED',
        chargeMethod: input.chargeMethod,
        roomId: input.roomId,
        reservationRoomId: stay?.reservationRoomId ?? null,
        guestId: stay?.guestId ?? null,
        items: input.items,
        notes: input.notes,
      });
    });
    await this.notify(order);
    return toOrderDto(order);
  }

  async list(propertyId: string, query: OrderListQuery): Promise<Order[]> {
    const rows = await this.db.run((tx) =>
      tx.order.findMany({
        where: {
          propertyId,
          ...(query.outletId ? { outletId: query.outletId } : {}),
          status: query.status === 'ACTIVE' ? { in: ACTIVE } : query.status,
        },
        include: orderInclude,
        orderBy: { createdAt: query.status === 'ACTIVE' ? 'asc' : 'desc' },
        take: query.limit,
      }),
    );
    return rows.map(toOrderDto);
  }

  async get(propertyId: string, id: string): Promise<Order> {
    const row = await this.db.run((tx) =>
      tx.order.findFirst({ where: { id, propertyId }, include: orderInclude }),
    );
    if (!row) throw Problems.notFound('Order');
    return toOrderDto(row);
  }

  /**
   * One step along PENDING → CONFIRMED → PREPARING → READY → (OUT_FOR_DELIVERY →)
   * DELIVERED. Delivering a room-charge order posts it to the guest folio in the same
   * transaction; the folio's source key makes a retried delivery a no-op.
   */
  async transition(
    propertyId: string,
    id: string,
    expectedVersion: number,
    to: OrderStatus,
  ): Promise<Order> {
    const order = await this.db.run(async (tx) => {
      const current = await tx.order.findFirst({
        where: { id, propertyId },
        include: { outlet: true },
      });
      if (!current) throw Problems.notFound('Order');
      if (!ORDER_TRANSITIONS[current.status].includes(to)) {
        throw invalidState(
          `An order that is ${current.status.toLowerCase().replaceAll('_', ' ')} cannot become ${to.toLowerCase().replaceAll('_', ' ')}.`,
        );
      }
      if (to === 'OUT_FOR_DELIVERY' && !current.roomId) {
        throw invalidState('Only room orders go out for delivery.');
      }
      const charge =
        to === 'DELIVERED' && current.chargeMethod === 'ROOM_CHARGE'
          ? await this.chargeToRoom(tx, current)
          : null;
      const { count } = await tx.order.updateMany({
        where: { id, version: expectedVersion, status: current.status },
        data: {
          status: to,
          version: { increment: 1 },
          ...(charge
            ? { folioId: charge.folioId, folioLineId: charge.lineId, chargedAt: new Date() }
            : {}),
        },
      });
      if (count !== 1) throw Problems.versionConflict();
      await tx.orderEvent.create({
        data: {
          organizationId: this.organizationId,
          orderId: id,
          fromStatus: current.status,
          toStatus: to,
          ...actorOf(this.cls),
        },
      });
      await this.outbox.enqueue(
        tx,
        'OrderStatusChanged',
        { orderId: id, outletId: current.outletId, from: current.status, to },
        { propertyId },
      );
      if (charge) {
        await this.outbox.enqueue(
          tx,
          'OrderCharged',
          {
            orderId: id,
            folioId: charge.folioId,
            lineId: charge.lineId,
            totalMinor: toMinor(current.totalMinor),
          },
          { propertyId },
        );
      }
      return tx.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
    });
    await this.notify(order);
    return toOrderDto(order);
  }

  private async chargeToRoom(
    tx: Tx,
    order: {
      id: string;
      orderNo: string;
      reservationRoomId: string | null;
      subtotalMinor: bigint;
      taxRules: Prisma.JsonValue;
      outlet: { name: string };
    },
  ): Promise<{ folioId: string; lineId: string }> {
    const folio = await tx.folio.findFirst({
      where: { reservationRoomId: order.reservationRoomId, status: 'OPEN' },
    });
    if (!folio) {
      throw invalidState('The guest has checked out; take payment instead of charging the room.');
    }
    const lineId = await this.folios.postInTx(tx, folio.id, {
      department: DEPARTMENT,
      description: `${order.outlet.name} ${order.orderNo}`,
      amountMinor: order.subtotalMinor,
      sourceKey: `order:${order.id}`,
      taxRules: order.taxRules as unknown as TaxRuleInput[],
    });
    return { folioId: folio.id, lineId };
  }

  /**
   * Before preparation anyone who handles orders may cancel; afterwards only with the
   * override permission. A room charge already posted is reversed, never deleted.
   */
  async cancel(
    propertyId: string,
    id: string,
    expectedVersion: number,
    reason: string,
    canOverride: boolean,
  ): Promise<Order> {
    const order = await this.db.run(async (tx) => {
      const current = await tx.order.findFirst({ where: { id, propertyId } });
      if (!current) throw Problems.notFound('Order');
      if (current.status === 'CANCELLED') throw invalidState('The order is already cancelled.');
      if (LATE.includes(current.status) && !canOverride) {
        throw Problems.forbidden(
          'Cancelling an order in preparation needs fnb.order.cancel_override.',
        );
      }
      return this.cancelInTx(tx, current, expectedVersion, reason);
    });
    await this.notify(order);
    return toOrderDto(order);
  }

  private async cancelInTx(
    tx: Tx,
    current: Prisma.OrderGetPayload<object>,
    expectedVersion: number,
    reason: string,
  ): Promise<OrderRow> {
    if (current.folioId && current.folioLineId) {
      await this.folios.reverseSourceInTx(tx, current.folioId, {
        sourceKey: `order:${current.id}`,
        amountMinor: current.subtotalMinor,
        reason: `Order ${current.orderNo} cancelled: ${reason}`,
        taxRules: current.taxRules as unknown as TaxRuleInput[],
      });
    }
    const { count } = await tx.order.updateMany({
      where: { id: current.id, version: expectedVersion, status: current.status },
      data: {
        status: 'CANCELLED',
        cancelReason: reason,
        cancelledAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (count !== 1) throw Problems.versionConflict();
    await tx.orderEvent.create({
      data: {
        organizationId: this.organizationId,
        orderId: current.id,
        fromStatus: current.status,
        toStatus: 'CANCELLED',
        note: reason,
        ...actorOf(this.cls),
      },
    });
    await this.audit.record(tx, {
      action: 'order.cancelled',
      entityType: 'order',
      entityId: current.id,
      propertyId: current.propertyId,
      before: { status: current.status, charged: current.folioLineId !== null },
      after: { reason },
    });
    await this.outbox.enqueue(
      tx,
      'OrderStatusChanged',
      { orderId: current.id, outletId: current.outletId, from: current.status, to: 'CANCELLED' },
      { propertyId: current.propertyId },
    );
    return tx.order.findUniqueOrThrow({ where: { id: current.id }, include: orderInclude });
  }

  // ---- Guest -------------------------------------------------------------------------------

  private get guest() {
    return this.cls.get('guest')!;
  }

  private async requireFoodOrdering(tx: Tx): Promise<void> {
    const flag = await tx.organizationFeatureFlag.findUnique({
      where: {
        organizationId_flagKey: {
          organizationId: this.organizationId,
          flagKey: 'guest_food_ordering',
        },
      },
    });
    if (!flag?.enabled) {
      throw new ProblemException(
        403,
        'FEATURE_DISABLED',
        'Food ordering is not offered',
        'Please call room service.',
      );
    }
  }

  /** Room-service menus of the guest's property. */
  async guestMenus(): Promise<Menu[]> {
    return this.db.run(async (tx) => {
      await this.requireFoodOrdering(tx);
      const outlets = await tx.outlet.findMany({
        where: { propertyId: this.cls.get('propertyId')!, roomService: true, active: true },
        orderBy: { name: 'asc' },
      });
      const menus: Menu[] = [];
      for (const outlet of outlets)
        menus.push(await this.menus.menuInTx(tx, outlet, { forGuest: true }));
      return menus;
    });
  }

  /** In-house guests order room service to their own room (spec §24, §14). */
  async guestPlace(input: GuestOrderRequest): Promise<Order> {
    const order = await this.db.run(async (tx) => {
      await this.requireFoodOrdering(tx);
      const propertyId = this.cls.get('propertyId')!;
      const line = await tx.reservationRoom.findUniqueOrThrow({
        where: { id: this.guest.reservationRoomId },
        include: { stays: { where: { checkedOutAt: null }, select: { roomId: true } } },
      });
      const stay = line.stays[0];
      if (line.status !== 'IN_HOUSE' || !stay)
        throw invalidState('Room service is available once you are checked in.');
      const outlet = await tx.outlet.findFirst({
        where: { id: input.outletId, propertyId, roomService: true },
      });
      if (!outlet) throw Problems.validation([{ path: 'outletId', message: 'Unknown outlet' }]);
      const property = await tx.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { timezone: true },
      });
      if (!isOpen(outlet, property.timezone)) throw outletClosed();
      if (input.chargeMethod === 'ROOM_CHARGE' && !outlet.allowRoomCharge) {
        throw Problems.validation([{ path: 'chargeMethod', message: 'Please pay on delivery' }]);
      }
      return this.create(tx, {
        propertyId,
        outlet,
        source: 'GUEST',
        status: 'PENDING',
        chargeMethod: input.chargeMethod,
        roomId: stay.roomId,
        reservationRoomId: line.id,
        guestId: this.guest.guestId,
        items: input.items,
        notes: input.notes,
      });
    });
    await this.notify(order);
    return toOrderDto(order);
  }

  async guestOrders(): Promise<Order[]> {
    const rows = await this.db.run((tx) =>
      tx.order.findMany({
        where: { reservationRoomId: this.guest.reservationRoomId, source: 'GUEST' },
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
    return rows.map(toOrderDto);
  }

  /** Guests may withdraw an order until the outlet accepts it. */
  async guestCancel(id: string): Promise<Order> {
    const order = await this.db.run(async (tx) => {
      const current = await tx.order.findFirst({
        where: { id, reservationRoomId: this.guest.reservationRoomId, source: 'GUEST' },
      });
      if (!current) throw Problems.notFound('Order');
      if (current.status !== 'PENDING') {
        throw invalidState(
          'The kitchen has accepted your order; please call room service to change it.',
        );
      }
      return this.cancelInTx(tx, current, current.version, 'Cancelled by guest');
    });
    await this.notify(order);
    return toOrderDto(order);
  }
}
