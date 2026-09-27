import { Injectable } from '@nestjs/common';
import type {
  CreateReservationRequest,
  Reservation,
  ReservationListQuery,
  UpdateReservationRoomRequest,
} from '@hotel/contracts';
import { Prisma, type Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate, nightsOf, toDbDate } from '../../common/dates.js';
import { withConstraintMapping } from '../../common/db-errors.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { GuestsService, toGuestSummary } from './guests.service.js';
import { releaseInventory, takeInventory } from './inventory.js';
import { priceStay, toMinor } from './pricing.js';
import { businessDateOf } from './rooms.service.js';

export const reservationInclude = {
  booker: true,
  rooms: {
    orderBy: { createdAt: 'asc' },
    include: {
      roomType: { select: { code: true } },
      ratePlan: { select: { code: true } },
      guest: true,
      nights: { orderBy: { stayDate: 'asc' } },
      assignments: { where: { releasedAt: null }, include: { room: { select: { number: true } } } },
    },
  },
} satisfies Prisma.ReservationInclude;

export type ReservationRow = Prisma.ReservationGetPayload<{ include: typeof reservationInclude }>;
type LineRow = ReservationRow['rooms'][number];

export function toReservationDto(r: ReservationRow): Reservation {
  const rooms = r.rooms.map((line) => {
    const total = line.nights.reduce((sum, n) => sum + n.amountMinor, 0n);
    const assignment = line.assignments[0];
    return {
      id: line.id,
      roomTypeId: line.roomTypeId,
      roomTypeCode: line.roomType.code,
      ratePlanId: line.ratePlanId,
      ratePlanCode: line.ratePlan.code,
      guest: toGuestSummary(line.guest),
      arrivalDate: fromDbDate(line.arrivalDate),
      departureDate: fromDbDate(line.departureDate),
      adults: line.adults,
      children: line.children,
      status: line.status,
      assignedRoom: assignment
        ? { roomId: assignment.roomId, number: assignment.room.number }
        : null,
      nights: line.nights.map((n) => ({
        date: fromDbDate(n.stayDate),
        amountMinor: toMinor(n.amountMinor),
      })),
      totalMinor: toMinor(total),
      version: line.version,
    };
  });
  return {
    id: r.id,
    propertyId: r.propertyId,
    confirmationNo: r.confirmationNo,
    status: r.status,
    source: r.source,
    externalRef: r.externalRef,
    specialRequests: r.specialRequests,
    notes: r.notes,
    currency: r.currency,
    booker: toGuestSummary(r.booker),
    rooms,
    totalMinor: rooms
      .filter((l) => l.status !== 'CANCELLED')
      .reduce((sum, l) => sum + l.totalMinor, 0),
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    cancelReason: r.cancelReason,
    createdAt: r.createdAt.toISOString(),
    version: r.version,
  };
}

export const invalidState = (detail: string) =>
  new ProblemException(409, 'INVALID_STATE', 'Not allowed in the current state', detail);

/** Next value of a per-property counter; row-locked, so concurrent callers get distinct values. */
export async function nextNumber(
  tx: Tx,
  organizationId: string,
  propertyId: string,
  name: string,
): Promise<bigint> {
  const [row] = await tx.$queryRaw<{ value: bigint }[]>`
    INSERT INTO number_sequences (organization_id, property_id, name, next_value)
    VALUES (${organizationId}::uuid, ${propertyId}::uuid, ${name}, 2)
    ON CONFLICT (property_id, name) DO UPDATE SET next_value = number_sequences.next_value + 1
    RETURNING next_value - 1 AS value`;
  return row!.value;
}

@Injectable()
export class ReservationsService {
  constructor(
    private readonly db: TenantDb,
    private readonly guests: GuestsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private get ctx() {
    return {
      organizationId: this.cls.get('organizationId')!,
      propertyId: this.cls.get('propertyId')!,
      actorId: this.cls.get('identityId') ?? null,
    };
  }

  async load(tx: Tx, reservationId: string): Promise<ReservationRow> {
    const row = await tx.reservation.findFirst({
      where: { id: reservationId, propertyId: this.ctx.propertyId },
      include: reservationInclude,
    });
    if (!row) throw Problems.notFound('Reservation');
    return row;
  }

  async get(reservationId: string): Promise<Reservation> {
    return toReservationDto(await this.db.run((tx) => this.load(tx, reservationId)));
  }

  async list(
    query: ReservationListQuery,
  ): Promise<{ items: Reservation[]; nextCursor: string | null }> {
    const q = query.q?.trim();
    const lineFilter: Prisma.ReservationRoomWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.arrivalFrom || query.arrivalTo
        ? {
            arrivalDate: {
              ...(query.arrivalFrom ? { gte: toDbDate(query.arrivalFrom) } : {}),
              ...(query.arrivalTo ? { lte: toDbDate(query.arrivalTo) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.db.run((tx) =>
      tx.reservation.findMany({
        where: {
          propertyId: this.ctx.propertyId,
          ...(Object.keys(lineFilter).length ? { rooms: { some: lineFilter } } : {}),
          ...(q
            ? {
                OR: [
                  { confirmationNo: { contains: q.toUpperCase() } },
                  { booker: { lastName: { contains: q, mode: 'insensitive' } } },
                  { booker: { firstName: { contains: q, mode: 'insensitive' } } },
                  {
                    rooms: { some: { guest: { lastName: { contains: q, mode: 'insensitive' } } } },
                  },
                ],
              }
            : {}),
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        include: reservationInclude,
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const items = rows.slice(0, query.limit);
    return {
      items: items.map(toReservationDto),
      nextCursor: rows.length > query.limit ? items.at(-1)!.id : null,
    };
  }

  // ---- Create ---------------------------------------------------------------------------

  async create(input: CreateReservationRequest): Promise<Reservation> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const row = await withConstraintMapping(() =>
      this.db.run(async (tx) => {
        const businessDate = await businessDateOf(tx, propertyId);
        const property = await tx.property.findUniqueOrThrow({
          where: { id: propertyId },
          select: { code: true, currency: true },
        });

        const booker =
          'guestId' in input.booker
            ? await this.guests.requireVisible(tx, input.booker.guestId)
            : await this.createGuestIfAllowed(tx, propertyId, input.booker.newGuest);

        const lines = [];
        for (const [index, line] of input.rooms.entries()) {
          const path = `rooms.${index}`;
          if (line.arrivalDate < businessDate) {
            throw Problems.validation([
              {
                path: `${path}.arrivalDate`,
                message: `Arrival cannot be before the business date ${businessDate}`,
              },
            ]);
          }
          await this.assertOccupancy(tx, line.roomTypeId, line.adults, line.children ?? 0, path);
          const guest = line.guestId ? await this.guests.requireVisible(tx, line.guestId) : booker;
          const nights = nightsOf(line.arrivalDate, line.departureDate);
          const priced = await this.priceForProperty(
            tx,
            line.ratePlanId,
            line.roomTypeId,
            nights,
            property.currency,
            path,
          );
          lines.push({ request: line, guestId: guest.id, nights: priced });
        }

        await takeInventory(
          tx,
          organizationId,
          propertyId,
          lines.map((l) => ({
            roomTypeId: l.request.roomTypeId,
            dates: l.nights.map((n) => n.date),
          })),
        );

        const number = await nextNumber(tx, organizationId, propertyId, 'reservation');
        const reservation = await tx.reservation.create({
          data: {
            organizationId,
            propertyId,
            confirmationNo: `${property.code}-${String(number).padStart(6, '0')}`,
            bookerGuestId: booker.id,
            source: input.source,
            externalRef: input.externalRef,
            specialRequests: input.specialRequests,
            notes: input.notes,
            currency: property.currency,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });

        const lineIds: string[] = [];
        for (const line of lines) {
          const created = await tx.reservationRoom.create({
            data: {
              organizationId,
              propertyId,
              reservationId: reservation.id,
              roomTypeId: line.request.roomTypeId,
              ratePlanId: line.request.ratePlanId,
              guestId: line.guestId,
              arrivalDate: toDbDate(line.request.arrivalDate),
              departureDate: toDbDate(line.request.departureDate),
              adults: line.request.adults,
              children: line.request.children ?? 0,
            },
          });
          await tx.reservationNight.createMany({
            data: line.nights.map((n) => ({
              organizationId,
              reservationRoomId: created.id,
              stayDate: toDbDate(n.date),
              amountMinor: n.amountMinor,
              currency: property.currency,
            })),
          });
          if (line.request.roomId) await this.assignInTx(tx, created.id, line.request.roomId);
          lineIds.push(created.id);
        }

        await this.audit.record(tx, {
          action: 'reservation.created',
          entityType: 'reservation',
          entityId: reservation.id,
          propertyId,
          after: {
            confirmationNo: reservation.confirmationNo,
            source: input.source,
            rooms: input.rooms.map((r) => ({
              roomTypeId: r.roomTypeId,
              ratePlanId: r.ratePlanId,
              arrivalDate: r.arrivalDate,
              departureDate: r.departureDate,
            })),
          },
        });
        await this.outbox.enqueue(
          tx,
          'ReservationCreated',
          {
            reservationId: reservation.id,
            confirmationNo: reservation.confirmationNo,
            roomLineIds: lineIds,
          },
          { propertyId },
        );
        return this.load(tx, reservation.id);
      }),
    );
    return toReservationDto(row);
  }

  private async createGuestIfAllowed(
    tx: Tx,
    propertyId: string,
    input: Parameters<GuestsService['createInTx']>[2],
  ) {
    if (!this.cls.get('grants')!.hasForProperty('guest.update', propertyId)) {
      throw Problems.forbidden('Creating a guest needs guest.update at this property');
    }
    return this.guests.createInTx(tx, propertyId, input);
  }

  private async assertOccupancy(
    tx: Tx,
    roomTypeId: string,
    adults: number,
    children: number,
    path: string,
  ) {
    const roomType = await tx.roomType.findFirst({
      where: { id: roomTypeId, propertyId: this.ctx.propertyId, archivedAt: null },
    });
    if (!roomType)
      throw Problems.validation([{ path: `${path}.roomTypeId`, message: 'Unknown room type' }]);
    if (adults + children > roomType.maxOccupancy) {
      throw Problems.validation([
        {
          path: `${path}.adults`,
          message: `${roomType.name} sleeps at most ${roomType.maxOccupancy}`,
        },
      ]);
    }
  }

  private async priceForProperty(
    tx: Tx,
    ratePlanId: string,
    roomTypeId: string,
    nights: string[],
    currency: string,
    path: string,
  ) {
    const plan = await tx.ratePlan.findFirst({
      where: { id: ratePlanId, propertyId: this.ctx.propertyId },
    });
    if (!plan || plan.archivedAt)
      throw Problems.validation([{ path: `${path}.ratePlanId`, message: 'Unknown rate plan' }]);
    const priced = await priceStay(tx, ratePlanId, roomTypeId, nights);
    if (priced.currency !== currency) {
      throw Problems.validation([
        {
          path: `${path}.ratePlanId`,
          message: 'Rate plan currency differs from the property currency',
        },
      ]);
    }
    return priced.nights;
  }

  // ---- Room assignment ------------------------------------------------------------------

  /**
   * Holds a specific room for the line's remaining nights. The EXCLUDE constraint on
   * room_assignments makes double assignment (or assigning a blocked room) impossible,
   * even between concurrent requests.
   */
  async assignInTx(tx: Tx, reservationRoomId: string, roomId: string): Promise<void> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const line = await tx.reservationRoom.findFirst({
      where: { id: reservationRoomId, propertyId },
    });
    if (!line) throw Problems.notFound('Reservation room');
    if (line.status !== 'RESERVED' && line.status !== 'IN_HOUSE') {
      throw invalidState(
        `A ${line.status.toLowerCase().replace('_', ' ')} booking cannot be assigned a room.`,
      );
    }
    const room = await tx.room.findFirst({ where: { id: roomId, propertyId, archivedAt: null } });
    if (!room) throw Problems.validation([{ path: 'roomId', message: 'Unknown room' }]);
    if (room.roomTypeId !== line.roomTypeId) {
      throw Problems.validation([
        { path: 'roomId', message: 'The room is of a different room type than the booking' },
      ]);
    }
    const businessDate = await businessDateOf(tx, propertyId);
    const arrival = fromDbDate(line.arrivalDate);
    // An in-house guest moving rooms only needs the new room from today on.
    const start = line.status === 'IN_HOUSE' && businessDate > arrival ? businessDate : arrival;

    const current = await tx.roomAssignment.findFirst({
      where: { reservationRoomId, releasedAt: null },
    });
    if (current?.roomId === roomId) return;
    if (current) {
      await tx.roomAssignment.update({
        where: { id: current.id },
        data: { releasedAt: new Date() },
      });
    }
    await tx.roomAssignment.create({
      data: {
        organizationId,
        propertyId,
        roomId,
        kind: 'RESERVATION',
        reservationRoomId,
        startDate: toDbDate(start),
        endDate: line.departureDate,
        createdBy: actorId,
      },
    });
    await this.outbox.enqueue(tx, 'RoomAssigned', { reservationRoomId, roomId }, { propertyId });
  }

  async assign(reservationId: string, lineId: string, roomId: string): Promise<Reservation> {
    const { propertyId } = this.ctx;
    const row = await withConstraintMapping(() =>
      this.db.run(async (tx) => {
        const reservation = await this.load(tx, reservationId);
        if (!reservation.rooms.some((l) => l.id === lineId))
          throw Problems.notFound('Reservation room');
        await this.assignInTx(tx, lineId, roomId);
        await this.audit.record(tx, {
          action: 'reservation.room_assigned',
          entityType: 'reservation',
          entityId: reservationId,
          propertyId,
          after: { reservationRoomId: lineId, roomId },
        });
        return this.load(tx, reservationId);
      }),
    );
    return toReservationDto(row);
  }

  async unassign(reservationId: string, lineId: string): Promise<Reservation> {
    const { propertyId } = this.ctx;
    const row = await this.db.run(async (tx) => {
      const reservation = await this.load(tx, reservationId);
      const line = reservation.rooms.find((l) => l.id === lineId);
      if (!line) throw Problems.notFound('Reservation room');
      if (line.status !== 'RESERVED')
        throw invalidState(
          'Only upcoming bookings can be unassigned. Move in-house guests instead.',
        );
      const current = line.assignments[0];
      if (current) {
        await tx.roomAssignment.update({
          where: { id: current.id },
          data: { releasedAt: new Date() },
        });
        await this.audit.record(tx, {
          action: 'reservation.room_unassigned',
          entityType: 'reservation',
          entityId: reservationId,
          propertyId,
          before: { reservationRoomId: lineId, roomId: current.roomId },
        });
        await this.outbox.enqueue(
          tx,
          'RoomUnassigned',
          { reservationRoomId: lineId, roomId: current.roomId },
          { propertyId },
        );
      }
      return this.load(tx, reservationId);
    });
    return toReservationDto(row);
  }

  // ---- Modify ---------------------------------------------------------------------------

  /**
   * Changes dates, room type, rate plan or occupancy of an upcoming booking. Inventory is
   * moved atomically (release old nights, take new ones) and all nights are re-priced at
   * current rates. A room assignment is kept when still valid.
   */
  async updateLine(
    reservationId: string,
    lineId: string,
    expectedVersion: number,
    input: UpdateReservationRoomRequest,
  ): Promise<Reservation> {
    const { organizationId, propertyId } = this.ctx;
    const row = await withConstraintMapping(() =>
      this.db.run(async (tx) => {
        const reservation = await this.load(tx, reservationId);
        const line = reservation.rooms.find((l) => l.id === lineId);
        if (!line) throw Problems.notFound('Reservation room');
        if (line.status !== 'RESERVED')
          throw invalidState('Only upcoming bookings can be modified here.');
        if (line.version !== expectedVersion) throw Problems.versionConflict();

        const next = {
          roomTypeId: input.roomTypeId ?? line.roomTypeId,
          ratePlanId: input.ratePlanId ?? line.ratePlanId,
          arrivalDate: input.arrivalDate ?? fromDbDate(line.arrivalDate),
          departureDate: input.departureDate ?? fromDbDate(line.departureDate),
          adults: input.adults ?? line.adults,
          children: input.children ?? line.children,
        };
        if (next.departureDate <= next.arrivalDate) {
          throw Problems.validation([
            { path: 'departureDate', message: 'Departure must be after arrival' },
          ]);
        }
        const businessDate = await businessDateOf(tx, propertyId);
        if (next.arrivalDate < businessDate) {
          throw Problems.validation([
            {
              path: 'arrivalDate',
              message: `Arrival cannot be before the business date ${businessDate}`,
            },
          ]);
        }
        await this.assertOccupancy(tx, next.roomTypeId, next.adults, next.children, 'room');
        if (input.guestId) await this.guests.requireVisible(tx, input.guestId);

        const changed = Object.keys(input).filter(
          (k) =>
            JSON.stringify(input[k as keyof typeof input]) !==
            JSON.stringify(this.currentValue(line, k)),
        );
        const stayChanged = ['roomTypeId', 'ratePlanId', 'arrivalDate', 'departureDate'].some((k) =>
          changed.includes(k),
        );

        if (stayChanged) {
          const oldNights = line.nights.map((n) => fromDbDate(n.stayDate));
          const newNights = nightsOf(next.arrivalDate, next.departureDate);
          await releaseInventory(tx, [{ roomTypeId: line.roomTypeId, dates: oldNights }]);
          await takeInventory(tx, organizationId, propertyId, [
            { roomTypeId: next.roomTypeId, dates: newNights },
          ]);
          const priced = await this.priceForProperty(
            tx,
            next.ratePlanId,
            next.roomTypeId,
            newNights,
            reservation.currency,
            'room',
          );
          await tx.reservationNight.deleteMany({ where: { reservationRoomId: lineId } });
          await tx.reservationNight.createMany({
            data: priced.map((n) => ({
              organizationId,
              reservationRoomId: lineId,
              stayDate: toDbDate(n.date),
              amountMinor: n.amountMinor,
              currency: reservation.currency,
            })),
          });
        }

        await tx.reservationRoom.update({
          where: { id: lineId },
          data: {
            roomTypeId: next.roomTypeId,
            ratePlanId: next.ratePlanId,
            arrivalDate: toDbDate(next.arrivalDate),
            departureDate: toDbDate(next.departureDate),
            adults: next.adults,
            children: next.children,
            ...(input.guestId ? { guestId: input.guestId } : {}),
            version: { increment: 1 },
          },
        });

        // Keep the assigned room if it still fits; otherwise the booking becomes unassigned.
        const current = line.assignments[0];
        if (current && stayChanged) {
          await tx.roomAssignment.update({
            where: { id: current.id },
            data: { releasedAt: new Date() },
          });
          if (next.roomTypeId === line.roomTypeId) {
            await tx.roomAssignment.create({
              data: {
                organizationId,
                propertyId,
                roomId: current.roomId,
                kind: 'RESERVATION',
                reservationRoomId: lineId,
                startDate: toDbDate(next.arrivalDate),
                endDate: toDbDate(next.departureDate),
                createdBy: this.ctx.actorId,
              },
            });
          }
        }

        await this.audit.record(tx, {
          action: 'reservation.modified',
          entityType: 'reservation',
          entityId: reservationId,
          propertyId,
          before: {
            reservationRoomId: lineId,
            roomTypeId: line.roomTypeId,
            ratePlanId: line.ratePlanId,
            arrivalDate: fromDbDate(line.arrivalDate),
            departureDate: fromDbDate(line.departureDate),
            adults: line.adults,
            children: line.children,
          },
          after: { reservationRoomId: lineId, ...next },
        });
        await this.outbox.enqueue(
          tx,
          'ReservationModified',
          { reservationId, reservationRoomId: lineId, changedFields: changed },
          { propertyId },
        );
        return this.load(tx, reservationId);
      }),
    );
    return toReservationDto(row);
  }

  private currentValue(line: LineRow, key: string): unknown {
    switch (key) {
      case 'arrivalDate':
        return fromDbDate(line.arrivalDate);
      case 'departureDate':
        return fromDbDate(line.departureDate);
      default:
        return (line as unknown as Record<string, unknown>)[key];
    }
  }

  // ---- Cancel ---------------------------------------------------------------------------

  /** Cancels upcoming lines (all, or one). In-house or finished stays cannot be cancelled. */
  async cancel(reservationId: string, reason: string, lineId?: string): Promise<Reservation> {
    const { propertyId } = this.ctx;
    const row = await this.db.run(async (tx) => {
      const reservation = await this.load(tx, reservationId);
      const targets = reservation.rooms.filter(
        (l) => (lineId ? l.id === lineId : true) && l.status === 'RESERVED',
      );
      if (lineId && !reservation.rooms.some((l) => l.id === lineId))
        throw Problems.notFound('Reservation room');
      if (targets.length === 0)
        throw invalidState('There is nothing upcoming to cancel on this reservation.');

      for (const line of targets) {
        await releaseInventory(tx, [
          { roomTypeId: line.roomTypeId, dates: line.nights.map((n) => fromDbDate(n.stayDate)) },
        ]);
        for (const a of line.assignments) {
          await tx.roomAssignment.update({ where: { id: a.id }, data: { releasedAt: new Date() } });
        }
        await tx.reservationRoom.update({
          where: { id: line.id },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        });
      }

      const stillActive = reservation.rooms.some(
        (l) => !targets.includes(l) && l.status !== 'CANCELLED',
      );
      if (!stillActive) {
        await tx.reservation.update({
          where: { id: reservationId },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelReason: reason,
            version: { increment: 1 },
          },
        });
      }
      await this.audit.record(tx, {
        action: 'reservation.cancelled',
        entityType: 'reservation',
        entityId: reservationId,
        propertyId,
        after: { reservationRoomIds: targets.map((l) => l.id), reason },
      });
      await this.outbox.enqueue(
        tx,
        'ReservationCancelled',
        { reservationId, reservationRoomIds: targets.map((l) => l.id), reason },
        { propertyId },
      );
      return this.load(tx, reservationId);
    });
    return toReservationDto(row);
  }
}
