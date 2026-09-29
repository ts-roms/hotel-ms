import { Inject, Injectable } from '@nestjs/common';
import type { GuestBill, GuestStay, PreCheckInRequest, SelfCheckInResult } from '@hotel/contracts';
import type { Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate } from '../../common/dates.js';
import { toMinor } from '../../common/money.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { toLocal } from '../../common/zoned-time.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { FrontOfficeService } from '../front-office/front-office.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { CardHoldsService } from '../finance/payments/card-holds.service.js';
import { FeatureFlagsService } from '../tenancy/feature-flags.service.js';
import { ReservationsService } from '../pms/reservations/reservations.service.js';
import { guestPortalSettingsInTx } from './guest-info.service.js';
import { GuestIdentityService } from '../pms/guests/guest-identity.service.js';
import { GuestsService } from '../pms/guests/guests.service.js';
import { GuestInboxService } from '../notifications/guest-inbox.service.js';
import { assignFirstFree } from './ready-room.js';
import { GuestSessions } from './guest-session.js';
import { ServiceRequestsService } from '../operations/service-requests/service-requests.service.js';
import { ROOM_ACCESS_PROVIDER, type RoomAccessProvider } from './room-access.js';

export const seeFrontDesk = (detail: string) =>
  new ProblemException(409, 'SEE_FRONT_DESK', 'Please see the front desk', detail);

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

/**
 * Guest-facing flows (blueprint §11): the stay, pre-check-in, self check-in and the bill.
 * Every method acts on the reservation of the current guest session; nothing takes a
 * reservation id from the guest. Links, sessions and verification: GuestAccessService.
 */
@Injectable()
export class GuestPortalService {
  constructor(
    private readonly db: TenantDb,
    private readonly sessions: GuestSessions,
    private readonly reservations: ReservationsService,
    private readonly frontOffice: FrontOfficeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(ROOM_ACCESS_PROVIDER) private readonly roomAccess: RoomAccessProvider,
    private readonly identity: GuestIdentityService,
    private readonly guestInbox: GuestInboxService,
    private readonly requests: ServiceRequestsService,
    private readonly guests: GuestsService,
    private readonly cardHolds: CardHoldsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private get guest() {
    return this.cls.get('guest')!;
  }

  // ---- Guest: stay ------------------------------------------------------------------------

  private async loadLine(tx: Tx) {
    return tx.reservationRoom.findUniqueOrThrow({
      where: { id: this.guest.reservationRoomId },
      include: {
        reservation: { include: { booker: { select: { email: true } } } },
        guest: true,
        roomType: { select: { name: true } },
        assignments: {
          where: { releasedAt: null },
          include: { room: { select: { number: true } } },
        },
      },
    });
  }

  private selfCheckInEnabled(tx: Tx): Promise<boolean> {
    return this.flags.isEnabledInTx(tx, 'self_checkin');
  }

  private async cardHold(
    tx: Tx,
    line: { id: string; propertyId: string; reservation: { currency: string } },
  ): Promise<GuestStay['cardHold']> {
    const state = await this.cardHolds.cardHoldStateInTx(tx, line.propertyId, line.id);
    if (state.requiredMinor === 0n) return null;
    return {
      requiredMinor: toMinor(state.requiredMinor),
      currency: line.reservation.currency,
      authorized: state.authorized,
    };
  }

  async stay(): Promise<GuestStay> {
    return this.db.run(async (tx) => {
      const line = await this.loadLine(tx);
      const property = await tx.property.findUniqueOrThrow({ where: { id: line.propertyId } });
      const businessDate = fromDbDate(property.currentBusinessDate);
      const email = line.reservation.booker.email;
      return {
        property: {
          name: property.name,
          city: property.city,
          phone: property.phone,
          email: property.email,
          checkInTime: property.checkInTime,
          checkOutTime: property.checkOutTime,
          timezone: property.timezone,
        },
        confirmationNo: line.reservation.confirmationNo,
        guest: { firstName: line.guest.firstName, lastName: line.guest.lastName },
        stay: {
          arrivalDate: fromDbDate(line.arrivalDate),
          departureDate: fromDbDate(line.departureDate),
          roomTypeName: line.roomType.name,
          adults: line.adults,
          children: line.children,
          status: line.status,
          // The room number is only shown once the guest is in house, and only to a verified
          // session: a forwarded link alone must not tell someone where the guest sleeps.
          roomNumber:
            line.status === 'IN_HOUSE' && this.guest.verified
              ? (line.assignments[0]?.room.number ?? null)
              : null,
          preCheckInCompleted: line.preCheckInAt !== null,
          expectedArrivalTime: line.expectedArrivalTime,
        },
        verified: this.guest.verified,
        verificationDestination: email ? maskEmail(email) : null,
        selfCheckInAvailable:
          line.status === 'RESERVED' &&
          fromDbDate(line.arrivalDate) === businessDate &&
          (await this.selfCheckInEnabled(tx)),
        cardHold: await this.cardHold(tx, line),
        identity: await this.identity.summaryInTx(tx, line.id),
        identityRequired: (await guestPortalSettingsInTx(tx, line.propertyId))
          .requireIdForSelfCheckIn,
        checkoutRequested: await this.requests.checkoutRequestedInTx(tx, line.id),
        unreadNotifications: await this.guestInbox.unreadInTx(tx, line.id),
        csrfToken: this.sessions.csrfTokenFor(this.guest.tokenHash),
      };
    });
  }

  async preCheckIn(input: PreCheckInRequest): Promise<GuestStay> {
    await this.db.run(async (tx) => {
      const line = await this.loadLine(tx);
      if (line.status !== 'RESERVED')
        throw Problems.conflict('Pre-check-in is only available before arrival.');
      await this.reservations.markPreCheckedInInTx(tx, line.id, input.expectedArrivalTime);
      if (input.phone) await this.guests.setPhoneFromPortalInTx(tx, line.guestId, input.phone);
      if (input.specialRequests) {
        await this.reservations.appendGuestRequestsInTx(
          tx,
          line.reservation,
          input.specialRequests,
        );
      }
      await this.audit.record(tx, {
        action: 'guest.pre_checked_in',
        entityType: 'reservation',
        entityId: line.reservationId,
        propertyId: line.propertyId,
        after: { expectedArrivalTime: input.expectedArrivalTime, phoneProvided: !!input.phone },
      });
      await this.outbox.enqueue(
        tx,
        'GuestPreCheckedIn',
        { reservationRoomId: line.id },
        { propertyId: line.propertyId },
      );
    });
    return this.stay();
  }

  /**
   * Self check-in (spec §24): the guest-side gates here (feature flag, verified session,
   * arrival day, check-in time, a room found), then the SAME check-in the front desk uses,
   * with all its rules. Any failure sends the guest to the front desk; nothing bypasses it.
   */
  async selfCheckIn(): Promise<SelfCheckInResult> {
    const { line, property, hold, identity } = await this.db.run(async (tx) => {
      const line = await this.loadLine(tx);
      const property = await tx.property.findUniqueOrThrow({ where: { id: line.propertyId } });
      if (!(await this.selfCheckInEnabled(tx))) {
        throw new ProblemException(
          403,
          'FEATURE_DISABLED',
          'Self check-in is not offered',
          'Please check in at the front desk.',
        );
      }
      const hold = await this.cardHolds.cardHoldStateInTx(tx, line.propertyId, line.id);
      const settings = await guestPortalSettingsInTx(tx, line.propertyId);
      const identity = settings.requireIdForSelfCheckIn
        ? await this.identity.summaryInTx(tx, line.id)
        : undefined;
      return { line, property, hold, identity };
    });
    if (line.status !== 'RESERVED') throw seeFrontDesk('This booking cannot be checked in online.');
    if (fromDbDate(line.arrivalDate) !== fromDbDate(property.currentBusinessDate)) {
      throw seeFrontDesk(
        `Online check-in opens on your arrival day, ${fromDbDate(line.arrivalDate)}.`,
      );
    }
    if (toLocal(new Date(), property.timezone).time < property.checkInTime) {
      throw seeFrontDesk(
        `Check-in starts at ${property.checkInTime}. Early arrival? The front desk will help.`,
      );
    }

    // The property's ID rule (ADR-0027): an approved ID before the room is handed over.
    if (identity !== undefined && identity?.status !== 'APPROVED') {
      throw identity?.status === 'PENDING'
        ? new ProblemException(
            409,
            'ID_REVIEW_PENDING',
            'ID not reviewed yet',
            'The front desk is checking your ID. Try again shortly, or see the front desk.',
          )
        : new ProblemException(
            409,
            'ID_REQUIRED',
            'ID required',
            'Upload a photo of your ID for the front desk to approve, then check in.',
          );
    }

    if (!hold.authorized) {
      throw new ProblemException(
        409,
        'HOLD_REQUIRED',
        'Card hold required',
        'Authorize a card hold for incidentals, then check in.',
      );
    }

    if (!line.assignments[0])
      await this.assignReadyRoom(line.id, line.roomTypeId, line.arrivalDate, line.departureDate);

    try {
      await this.frontOffice.checkIn(line.reservationId, line.id);
    } catch (error) {
      if (error instanceof ProblemException && error.status === 409) {
        throw seeFrontDesk(
          'We could not complete online check-in. The front desk will finish it for you.',
        );
      }
      throw error;
    }

    const checkedIn = await this.db.run(async (tx) => ({
      line: await this.loadLine(tx),
      stay: await tx.stay.findUniqueOrThrow({ where: { reservationRoomId: line.id } }),
    }));
    const roomNumber = checkedIn.line.assignments[0]!.room.number;
    const access = await this.roomAccess.createAccess({
      propertyId: property.id,
      roomNumber,
      stayId: checkedIn.stay.id,
      validFrom: new Date(),
      validTo: new Date(`${fromDbDate(checkedIn.line.departureDate)}T12:00:00Z`),
      guestName: `${checkedIn.line.guest.firstName} ${checkedIn.line.guest.lastName}`,
    });
    return { roomNumber, access };
  }

  /**
   * Picks a ready room of the booked type that is free for the whole stay. A concurrent
   * assignment of the same room loses on the exclusion constraint; the next candidate is
   * tried in a fresh transaction.
   */
  private async assignReadyRoom(
    lineId: string,
    roomTypeId: string,
    arrival: Date,
    departure: Date,
  ): Promise<void> {
    const propertyId = this.cls.get('propertyId')!;
    const candidates = await this.db.run((tx) =>
      this.frontOffice.readyRoomsInTx(tx, { propertyId, roomTypeId, arrival, departure }),
    );
    const assigned = await assignFirstFree(candidates, (room) =>
      this.db.run((tx) => this.reservations.assignInTx(tx, lineId, room.id)),
    );
    if (assigned) return;
    throw seeFrontDesk(
      'No room is ready for you yet. The front desk will let you know as soon as one is.',
    );
  }

  async bill(): Promise<GuestBill> {
    return this.db.run(async (tx) => {
      const folio = await tx.folio.findFirst({
        where: { reservationRoomId: this.guest.reservationRoomId },
        include: { lines: { orderBy: [{ postedAt: 'asc' }, { id: 'asc' }] } },
      });
      const reservation = await tx.reservation.findUniqueOrThrow({
        where: { id: this.guest.reservationId },
      });
      if (!folio) return { currency: reservation.currency, balanceMinor: 0, lines: [] };
      return {
        currency: folio.currency,
        balanceMinor: Number(folio.balanceMinor),
        lines: folio.lines.map((l) => ({
          date: fromDbDate(l.businessDate),
          description: l.description,
          amountMinor: Number(l.amountMinor),
        })),
      };
    });
  }
}
