import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { GuestStay } from '@hotel/contracts';
import { ClsService } from 'nestjs-cls';
import { newToken, sha256 } from '../../common/crypto.js';
import { addDays, fromDbDate } from '../../common/dates.js';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { ENV, type Env } from '../../config/env.js';
import { TenantDb } from '../../infrastructure/database.js';
import { NotificationsQueue } from '../../infrastructure/queue.js';
import { CacheRedis, RateLimiter } from '../../infrastructure/redis.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { ReservationsService } from '../pms/reservations/reservations.service.js';
import { GuestPortalService, seeFrontDesk } from './guest-portal.service.js';

const CODE_TTL_SECONDS = 600;
const SESSION_MAX_DAYS = 30;

/**
 * Access to the guest portal (blueprint §11, ADR-0033): the emailed portal link, the guest
 * session it opens, and the email code that verifies the session.
 */
@Injectable()
export class GuestAccessService {
  constructor(
    private readonly db: TenantDb,
    private readonly portal: GuestPortalService,
    private readonly reservations: ReservationsService,
    private readonly notifications: NotificationsQueue,
    private readonly redis: CacheRedis,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(ENV) private readonly env: Env,
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
      // A new link replaces the old one: sessions opened from it end too, so re-sending
      // a link that went to the wrong person actually locks that person out.
      const now = new Date();
      await tx.guestPortalLink.updateMany({
        where: { reservationId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.guestSession.updateMany({
        where: { reservationId, revokedAt: null },
        data: { revokedAt: now },
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
    return { token: sessionToken, expiresAt, stay: await this.portal.stay() };
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
    // Per booking as well: a new session from the same link must not reset the budget
    // (or flood the booker's inbox).
    await this.rateLimiter.consume(`guest-code-send:res:${this.guest.reservationId}`, 6, 60 * 60, {
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
    await this.rateLimiter.consume(
      `guest-code-verify:res:${this.guest.reservationId}`,
      15,
      60 * 60,
      { failClosed: true },
    );
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
    return this.portal.stay();
  }
}
