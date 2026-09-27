import { Injectable } from '@nestjs/common';
import type { FrontDesk, FrontDeskItem, Reservation } from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate, nightsOf, toDbDate } from '../../common/dates.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { FolioService } from '../folio/folio.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { toGuestSummary } from '../pms/guests.service.js';
import { releaseInventory } from '../pms/inventory.js';
import {
  invalidState,
  ReservationsService,
  toReservationDto,
} from '../pms/reservations.service.js';
import { businessDateOf } from '../pms/rooms.service.js';
import { ensureHousekeepingTask, recordRoomStatus } from './room-status.js';

export const frontDeskInclude = {
  reservation: { select: { id: true, confirmationNo: true, currency: true, status: true } },
  guest: true,
  roomType: { select: { code: true } },
  assignments: {
    where: { releasedAt: null },
    include: { room: { select: { id: true, number: true, housekeepingStatus: true } } },
  },
  folios: { select: { id: true, balanceMinor: true } },
} satisfies Prisma.ReservationRoomInclude;

type FrontDeskRow = Prisma.ReservationRoomGetPayload<{ include: typeof frontDeskInclude }>;

export function toFrontDeskItem(line: FrontDeskRow): FrontDeskItem {
  const room = line.assignments[0]?.room ?? null;
  const folio = line.folios[0] ?? null;
  return {
    reservationId: line.reservation.id,
    reservationRoomId: line.id,
    confirmationNo: line.reservation.confirmationNo,
    guest: toGuestSummary(line.guest),
    roomTypeCode: line.roomType.code,
    room,
    arrivalDate: fromDbDate(line.arrivalDate),
    departureDate: fromDbDate(line.departureDate),
    adults: line.adults,
    children: line.children,
    status: line.status,
    folioId: folio?.id ?? null,
    balanceMinor: folio ? Number(folio.balanceMinor) : null,
    currency: line.reservation.currency,
  };
}

const roomNotReady = (detail: string) =>
  new ProblemException(409, 'ROOM_NOT_READY', 'Room not ready', detail);

@Injectable()
export class FrontOfficeService {
  constructor(
    private readonly db: TenantDb,
    private readonly reservations: ReservationsService,
    private readonly folios: FolioService,
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

  async board(): Promise<FrontDesk> {
    const { propertyId } = this.ctx;
    return this.db.run(async (tx) => {
      const businessDate = await businessDateOf(tx, propertyId);
      const day = toDbDate(businessDate);
      const find = (where: Prisma.ReservationRoomWhereInput) =>
        tx.reservationRoom.findMany({
          where: { propertyId, ...where },
          include: frontDeskInclude,
          orderBy: [{ arrivalDate: 'asc' }, { createdAt: 'asc' }],
        });
      const [arrivals, inHouse, departures] = await Promise.all([
        find({ status: 'RESERVED', arrivalDate: day }),
        find({ status: 'IN_HOUSE', departureDate: { gt: day } }),
        find({ status: 'IN_HOUSE', departureDate: { lte: day } }),
      ]);
      return {
        businessDate,
        arrivals: arrivals.map(toFrontDeskItem),
        inHouse: inHouse.map(toFrontDeskItem),
        departures: departures.map(toFrontDeskItem),
      };
    });
  }

  /**
   * Check-in (§12.5). Rules live here, in one place, for the front desk and (later) the
   * guest self check-in flow alike.
   */
  async checkIn(reservationId: string, lineId: string): Promise<Reservation> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const row = await this.db.run(async (tx) => {
      const reservation = await this.reservations.load(tx, reservationId);
      const line = reservation.rooms.find((l) => l.id === lineId);
      if (!line) throw Problems.notFound('Reservation room');
      if (reservation.status !== 'CONFIRMED' || line.status !== 'RESERVED') {
        throw invalidState(
          `A ${line.status.toLowerCase().replace('_', ' ')} booking cannot be checked in.`,
        );
      }
      const businessDate = await businessDateOf(tx, propertyId);
      if (fromDbDate(line.arrivalDate) !== businessDate) {
        throw invalidState(
          `Arrival is ${fromDbDate(line.arrivalDate)}; the business date is ${businessDate}.`,
        );
      }
      const assignment = line.assignments[0];
      if (!assignment) throw roomNotReady('Assign a room before checking in.');
      const room = await tx.room.findUniqueOrThrow({ where: { id: assignment.roomId } });
      if (room.serviceStatus === 'OUT_OF_ORDER')
        throw roomNotReady(`Room ${room.number} is out of order.`);
      if (room.housekeepingStatus !== 'CLEAN' && room.housekeepingStatus !== 'INSPECTED') {
        throw roomNotReady(`Room ${room.number} is ${room.housekeepingStatus.toLowerCase()}.`);
      }
      const occupied = await tx.stay.count({ where: { roomId: room.id, checkedOutAt: null } });
      if (occupied > 0) throw roomNotReady(`Room ${room.number} is still occupied.`);

      const stay = await tx.stay.create({
        data: {
          organizationId,
          propertyId,
          reservationRoomId: lineId,
          roomId: room.id,
          checkedInBy: actorId,
        },
      });
      const folio = await this.folios.openInTx(tx, lineId, reservation.currency);
      await tx.reservationRoom.update({
        where: { id: lineId },
        data: { status: 'IN_HOUSE', version: { increment: 1 } },
      });

      await this.audit.record(tx, {
        action: 'stay.checked_in',
        entityType: 'reservation',
        entityId: reservationId,
        propertyId,
        after: { reservationRoomId: lineId, stayId: stay.id, roomId: room.id, folioId: folio.id },
      });
      await this.outbox.enqueue(
        tx,
        'GuestCheckedIn',
        { reservationRoomId: lineId, stayId: stay.id, roomId: room.id, folioId: folio.id },
        { propertyId },
      );
      return this.reservations.load(tx, reservationId);
    });
    return toReservationDto(row);
  }

  /**
   * Check-out: the folio must be settled. Leaving before the booked departure gives the
   * remaining nights back to sale. The room becomes dirty and gets a cleaning task.
   */
  async checkOut(reservationId: string, lineId: string): Promise<Reservation> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const row = await this.db.run(async (tx) => {
      const reservation = await this.reservations.load(tx, reservationId);
      const line = reservation.rooms.find((l) => l.id === lineId);
      if (!line) throw Problems.notFound('Reservation room');
      if (line.status !== 'IN_HOUSE')
        throw invalidState('Only in-house guests can be checked out.');
      const stay = await tx.stay.findUniqueOrThrow({ where: { reservationRoomId: lineId } });
      const folio = await tx.folio.findFirstOrThrow({ where: { reservationRoomId: lineId } });
      if (folio.balanceMinor !== 0n) {
        throw new ProblemException(
          409,
          'BALANCE_OUTSTANDING',
          'Folio not settled',
          `The folio balance is ${folio.balanceMinor} (minor units). Settle it before checking out.`,
        );
      }

      const businessDate = await businessDateOf(tx, propertyId);
      await this.shortenStay(tx, line, businessDate);

      await tx.folio.update({
        where: { id: folio.id },
        data: { status: 'CLOSED', closedAt: new Date(), version: { increment: 1 } },
      });
      await tx.stay.update({
        where: { id: stay.id },
        data: { checkedOutAt: new Date(), checkedOutBy: actorId },
      });
      await tx.reservationRoom.update({
        where: { id: lineId },
        data: { status: 'CHECKED_OUT', version: { increment: 1 } },
      });

      await recordRoomStatus(
        tx,
        {
          organizationId,
          propertyId,
          roomId: stay.roomId,
          to: 'DIRTY',
          reason: 'Check-out',
          actorId,
        },
        this.outbox,
      );
      // The departed guest's stayover cleaning is superseded by the checkout clean.
      await tx.housekeepingTask.updateMany({
        where: { roomId: stay.roomId, type: 'STAYOVER', status: { in: ['OPEN', 'IN_PROGRESS'] } },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      await ensureHousekeepingTask(tx, {
        organizationId,
        propertyId,
        roomId: stay.roomId,
        type: 'CHECKOUT_CLEAN',
        businessDate: toDbDate(businessDate),
        actorId,
      });

      await this.audit.record(tx, {
        action: 'stay.checked_out',
        entityType: 'reservation',
        entityId: reservationId,
        propertyId,
        after: { reservationRoomId: lineId, stayId: stay.id, folioId: folio.id },
      });
      await this.outbox.enqueue(
        tx,
        'GuestCheckedOut',
        { reservationRoomId: lineId, stayId: stay.id, roomId: stay.roomId, folioId: folio.id },
        { propertyId },
      );
      return this.reservations.load(tx, reservationId);
    });
    return toReservationDto(row);
  }

  /** Early departure: release unused nights (from today) and free the room from today. */
  private async shortenStay(
    tx: Tx,
    line: Awaited<ReturnType<ReservationsService['load']>>['rooms'][number],
    businessDate: string,
  ): Promise<void> {
    const departure = fromDbDate(line.departureDate);
    if (businessDate >= departure) return;
    const unused = nightsOf(businessDate, departure);
    await releaseInventory(tx, [{ roomTypeId: line.roomTypeId, dates: unused }]);
    await tx.reservationNight.deleteMany({
      where: { reservationRoomId: line.id, stayDate: { gte: toDbDate(businessDate) } },
    });
    const arrival = fromDbDate(line.arrivalDate);
    const assignment = line.assignments[0];
    if (assignment) {
      if (businessDate > arrival) {
        await tx.roomAssignment.update({
          where: { id: assignment.id },
          data: { endDate: toDbDate(businessDate) },
        });
      } else {
        // Leaving on the arrival day: no night was stayed.
        await tx.roomAssignment.update({
          where: { id: assignment.id },
          data: { releasedAt: new Date() },
        });
      }
    }
    if (businessDate > arrival) {
      await tx.reservationRoom.update({
        where: { id: line.id },
        data: { departureDate: toDbDate(businessDate) },
      });
    }
  }
}
