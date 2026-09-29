import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { GuestBill, GuestStay, PreCheckInRequest, SelfCheckInResult } from '@hotel/contracts';
import type { Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { newToken, sha256 } from '../../common/crypto.js';
import { addDays, fromDbDate } from '../../common/dates.js';
import { toMinor } from '../../common/money.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { ENV, type Env } from '../../config/env.js';
import { TenantDb } from '../../infrastructure/database.js';
import { NotificationsQueue } from '../../infrastructure/queue.js';
import { CacheRedis, RateLimiter } from '../../infrastructure/redis.js';
import { AuditService } from '../audit/audit.service.js';
import { FrontOfficeService } from '../front-office/front-office.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { cardHoldStateInTx } from '../finance/payments/holds.js';
import { ReservationsService } from '../pms/reservations/reservations.service.js';
import { guestPortalSettingsInTx } from './guest-info.service.js';
import { GuestIdentityService } from '../pms/guests/guest-identity.service.js';
import { GuestInboxService } from '../notifications/guest-inbox.service.js';
import { GuestSessions } from './guest-session.js';
import { ServiceRequestsService } from '../operations/service-requests/service-requests.service.js';
import { ROOM_ACCESS_PROVIDER, type RoomAccessProvider } from './room-access.js';

const CODE_TTL_SECONDS = 600;
const SESSION_MAX_DAYS = 30;

const seeFrontDesk = (detail: string) =>
  new ProblemException(409, 'SEE_FRONT_DESK', 'Please see the front desk', detail);

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** "HH:mm" now in an IANA time zone. */
function localTimeNow(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

/**
 * Guest-facing flows (blueprint §11). Every method acts on the reservation of the current
 * guest session; nothing takes a reservation id from the guest.
 */
@Injectable()
export class GuestPortalService {
  constructor(
    private readonly db: TenantDb,
    private readonly sessions: GuestSessions,
    private readonly reservations: ReservationsService,
    private readonly frontOffice: FrontOfficeService,
    private readonly notifications: NotificationsQueue,
    private readonly redis: CacheRedis,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(ROOM_ACCESS_PROVIDER) private readonly roomAccess: RoomAccessProvider,
    @Inject(ENV) private readonly env: Env,
    private readonly identity: GuestIdentityService,
    private readonly guestInbox: GuestInboxService,
    private readonly requests: ServiceRequestsService,
  ) {}

  private get guest() {
    return this.cls.get('guest')!;
  }

  // ---- Staff: send the portal link ------------------------------------------------------

  /**
   * Issues a fresh portal link and emails it: on request by staff, or as the day-before
   * check-in reminder (ADR-0024). A new link revokes earlier ones.
   */
  async sendLink(
    reservationId: string,
    template: 'guest-portal-link' | 'checkin-reminder' = 'guest-portal-link',
  ): Promise<void> {
    const organizationId = this.cls.get('organizationId')!;
    const propertyId = this.cls.get('propertyId')!;
    const token = newToken();
    const email = await this.db.run(async (tx) => {
      const reservation = await this.reservations.load(tx, reservationId);
      if (reservation.status !== 'CONFIRMED')
        throw Problems.conflict('The reservation is cancelled.');
      if (!reservation.booker.email) {
        throw Problems.validation([
          { path: 'booker.email', message: 'The booker has no email address' },
        ]);
      }
      const lastDeparture = reservation.rooms
        .map((l) => fromDbDate(l.departureDate))
        .sort()
        .at(-1)!;
      await tx.guestPortalLink.updateMany({
        where: { reservationId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.guestPortalLink.create({
        data: {
          organizationId,
          propertyId,
          reservationId,
          tokenHash: sha256(token),
          expiresAt: new Date(`${addDays(lastDeparture, 2)}T00:00:00Z`),
          createdBy: this.cls.get('identityId') ?? null,
        },
      });
      await this.audit.record(tx, {
        action: 'guest_portal.link_sent',
        entityType: 'reservation',
        entityId: reservationId,
        propertyId,
      });
      await this.outbox.enqueue(tx, 'GuestPortalLinkSent', { reservationId }, { propertyId });
      const property = await tx.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { name: true, checkInTime: true },
      });
      return {
        to: reservation.booker.email,
        guestName: reservation.booker.firstName,
        propertyName: property.name,
        checkInTime: property.checkInTime,
        arrivalDate: fromDbDate(reservation.rooms[0]!.arrivalDate),
      };
    });
    const portalUrl = `${this.env.GUEST_PUBLIC_URL}/welcome#token=${token}`;
    const base = {
      guestName: email.guestName,
      propertyName: email.propertyName,
      arrivalDate: email.arrivalDate,
      portalUrl,
    };
    await this.notifications.sendEmail(
      template === 'checkin-reminder'
        ? { template, to: email.to, data: { ...base, checkInTime: email.checkInTime } }
        : { template, to: email.to, data: base },
    );
  }

  // ---- Guest: session -------------------------------------------------------------------

  /** Exchanges a portal link token for a guest session (the cookie holds the new token). */
  async exchange(token: string): Promise<{ token: string; expiresAt: Date; stay: GuestStay }> {
    await this.rateLimiter.consume(
      `guest-exchange:ip:${this.cls.get('ip') ?? 'unknown'}`,
      20,
      15 * 60,
    );
    const linkHash = sha256(token);
    const link = await this.db.runWithGuestToken({ guestLinkHash: linkHash }, (tx) =>
      tx.guestPortalLink.findUnique({ where: { tokenHash: linkHash } }),
    );
    if (!link || link.revokedAt || link.expiresAt <= new Date()) throw Problems.invalidToken();

    const sessionToken = newToken();
    const tokenHash = sha256(sessionToken);
    const expiresAt = new Date(
      Math.min(link.expiresAt.getTime(), Date.now() + SESSION_MAX_DAYS * 86_400_000),
    );
    // Trusted: the organization comes from the link row the token resolved to.
    const session = await this.db.runWithTrustedContext(
      { organizationId: link.organizationId, identityId: null },
      async (tx) => {
        const reservation = await tx.reservation.findUniqueOrThrow({
          where: { id: link.reservationId },
          include: {
            rooms: {
              where: { status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
              orderBy: { createdAt: 'asc' },
            },
          },
        });
        const line = reservation.rooms[0];
        if (reservation.status !== 'CONFIRMED' || !line) throw Problems.invalidToken();
        return tx.guestSession.create({
          data: {
            organizationId: link.organizationId,
            propertyId: link.propertyId,
            reservationId: reservation.id,
            reservationRoomId: line.id,
            guestId: line.guestId,
            tokenHash,
            expiresAt,
            ip: this.cls.get('ip'),
            userAgent: this.cls.get('userAgent')?.slice(0, 512) ?? null,
          },
        });
      },
    );
    this.cls.set('organizationId', session.organizationId);
    this.cls.set('propertyId', session.propertyId);
    this.cls.set('guest', {
      sessionId: session.id,
      tokenHash,
      reservationId: session.reservationId,
      reservationRoomId: session.reservationRoomId,
      guestId: session.guestId,
      verified: false,
    });
    return { token: sessionToken, expiresAt, stay: await this.stay() };
  }

  async logout(): Promise<void> {
    await this.db.run((tx) =>
      tx.guestSession.update({
        where: { id: this.guest.sessionId },
        data: { revokedAt: new Date() },
      }),
    );
  }

  // ---- Guest: verification code ---------------------------------------------------------

  private codeKey(): string {
    return CacheRedis.tenantKey(
      this.cls.get('organizationId')!,
      'guest-code',
      this.guest.sessionId,
    );
  }

  async requestCode(): Promise<void> {
    await this.rateLimiter.consume(`guest-code-send:${this.guest.sessionId}`, 3, 15 * 60, {
      failClosed: true,
    });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const target = await this.db.run(async (tx) => {
      const reservation = await tx.reservation.findUniqueOrThrow({
        where: { id: this.guest.reservationId },
        include: { booker: { select: { email: true } }, property: { select: { name: true } } },
      });
      return { email: reservation.booker.email, propertyName: reservation.property.name };
    });
    if (!target.email) throw seeFrontDesk('There is no email address on the booking.');
    await this.redis.client.set(
      this.codeKey(),
      createHash('sha256').update(code).digest('hex'),
      'EX',
      CODE_TTL_SECONDS,
    );
    await this.notifications.sendEmail({
      template: 'guest-verification-code',
      to: target.email,
      data: { propertyName: target.propertyName, code, expiresInMinutes: CODE_TTL_SECONDS / 60 },
    });
  }

  async verifyCode(code: string): Promise<GuestStay> {
    await this.rateLimiter.consume(`guest-code-verify:${this.guest.sessionId}`, 5, 5 * 60, {
      failClosed: true,
    });
    const stored = await this.redis.client.get(this.codeKey());
    if (!stored || stored !== createHash('sha256').update(code).digest('hex'))
      throw Problems.invalidMfaCode();
    await this.redis.client.del(this.codeKey());
    await this.db.run((tx) =>
      tx.guestSession.update({
        where: { id: this.guest.sessionId },
        data: { verifiedAt: new Date() },
      }),
    );
    this.cls.set('guest', { ...this.guest, verified: true });
    return this.stay();
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

  private async selfCheckInEnabled(tx: Tx): Promise<boolean> {
    const flag = await tx.organizationFeatureFlag.findUnique({
      where: {
        organizationId_flagKey: {
          organizationId: this.cls.get('organizationId')!,
          flagKey: 'self_checkin',
        },
      },
    });
    return flag?.enabled ?? false;
  }

  private async cardHold(
    tx: Tx,
    line: { id: string; propertyId: string; reservation: { currency: string } },
  ): Promise<GuestStay['cardHold']> {
    const state = await cardHoldStateInTx(tx, line.propertyId, line.id);
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
          // The room number is only shown once the guest is in house.
          roomNumber:
            line.status === 'IN_HOUSE' ? (line.assignments[0]?.room.number ?? null) : null,
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
      await tx.reservationRoom.update({
        where: { id: line.id },
        data: { expectedArrivalTime: input.expectedArrivalTime, preCheckInAt: new Date() },
      });
      if (input.phone) {
        await tx.guest.update({
          where: { id: line.guestId },
          data: { phone: input.phone, version: { increment: 1 } },
        });
      }
      if (input.specialRequests) {
        const existing = line.reservation.specialRequests;
        await tx.reservation.update({
          where: { id: line.reservationId },
          data: {
            specialRequests: [existing, `Guest: ${input.specialRequests}`]
              .filter(Boolean)
              .join('\n')
              .slice(0, 2000),
          },
        });
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
      const hold = await cardHoldStateInTx(tx, line.propertyId, line.id);
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
    if (localTimeNow(property.timezone) < property.checkInTime) {
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
      tx.room.findMany({
        where: {
          propertyId,
          roomTypeId,
          archivedAt: null,
          serviceStatus: 'IN_SERVICE',
          housekeepingStatus: { in: ['INSPECTED', 'CLEAN'] },
          stays: { none: { checkedOutAt: null } },
          assignments: {
            none: { releasedAt: null, startDate: { lt: departure }, endDate: { gt: arrival } },
          },
        },
        orderBy: { number: 'asc' },
        take: 10,
      }),
    );
    // Inspected rooms first: they need no further housekeeping check.
    candidates.sort(
      (a, b) =>
        Number(b.housekeepingStatus === 'INSPECTED') - Number(a.housekeepingStatus === 'INSPECTED'),
    );
    for (const room of candidates) {
      try {
        await this.db.run((tx) => this.reservations.assignInTx(tx, lineId, room.id));
        return;
      } catch {
        // Taken meanwhile; try the next one.
      }
    }
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
