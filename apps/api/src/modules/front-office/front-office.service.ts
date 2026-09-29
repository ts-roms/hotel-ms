import { Injectable } from '@nestjs/common';
import type { FrontDesk, FrontDeskItem, Reservation } from '@hotel/contracts';
import type { Prisma } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate, toDbDate } from '../../common/dates.js';
import { ProblemException, Problems, invalidState } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { FolioService } from '../finance/folio/folio.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { toGuestSummary } from '../pms/guests/guests.service.js';
import { ReservationsService, toReservationDto } from '../pms/reservations/reservations.service.js';
import { businessDateOf } from '../../common/business-date.js';
import { RoomsService } from '../pms/inventory/rooms.service.js';
import { HousekeepingService } from '../operations/housekeeping/housekeeping.service.js';
import { ServiceRequestsService } from '../operations/service-requests/service-requests.service.js';
import { GuestMessagesService } from '../notifications/guest-messages.service.js';
import { GuestInboxService } from '../notifications/guest-inbox.service.js';

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
    private readonly rooms: RoomsService,
    private readonly housekeeping: HousekeepingService,
    private readonly serviceRequests: ServiceRequestsService,
    private readonly guestMessages: GuestMessagesService,
    private readonly guestInbox: GuestInboxService,
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
      await this.reservations.setStayStatusInTx(tx, lineId, 'IN_HOUSE');

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
    await this.guestMessages.checkedIn(lineId);
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
      await this.reservations.shortenLineInTx(tx, line, businessDate);

      await this.folios.closeInTx(tx, folio.id);
      await tx.stay.update({
        where: { id: stay.id },
        data: { checkedOutAt: new Date(), checkedOutBy: actorId },
      });
      await this.reservations.setStayStatusInTx(tx, lineId, 'CHECKED_OUT');

      await this.rooms.setHousekeepingStatusInTx(tx, {
        organizationId,
        propertyId,
        roomId: stay.roomId,
        to: 'DIRTY',
        reason: 'Check-out',
        actorId,
      });
      // The departed guest's stayover cleaning is superseded by the checkout clean.
      await this.housekeeping.cancelOpenTasksInTx(tx, stay.roomId, 'STAYOVER');
      await this.housekeeping.ensureTaskInTx(tx, {
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
      // A checkout the guest asked for in the portal is now done (ADR-0027).
      await this.serviceRequests.completeCheckoutRequestsInTx(tx, lineId);
      await this.guestInbox.notifyInTx(tx, {
        reservationRoomId: lineId,
        propertyId,
        kind: 'CHECKOUT',
        title: "You're checked out",
        body: 'Thank you for staying with us. Your final bill is under "Your bill".',
      });
      return this.reservations.load(tx, reservationId);
    });
    return toReservationDto(row);
  }
}
