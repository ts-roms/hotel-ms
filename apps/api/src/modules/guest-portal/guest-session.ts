import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { GUEST_ROUTE, type GuestRouteOptions } from '../../common/route-metadata.js';
import { ENV, type Env } from '../../config/env.js';
import { TenantDb } from '../../infrastructure/database.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOUCH_INTERVAL_MS = 60_000;

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

/**
 * Guest sessions (blueprint §11.1): a separate cookie, a separate table, and a principal
 * bound to one reservation. The session row is found by token hash through an RLS policy,
 * and its organization becomes the request's tenant context.
 */
@Injectable()
export class GuestSessions {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get cookieName(): string {
    return this.env.COOKIE_SECURE ? '__Host-hotel_guest' : 'hotel_guest';
  }

  cookieOptions(expiresAt: Date) {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: '/',
      expires: expiresAt,
    };
  }

  csrfTokenFor(tokenHash: string): string {
    return createHmac('sha256', this.env.SESSION_SECRET)
      .update(`guest-csrf:${tokenHash}`)
      .digest('base64url');
  }

  verifyCsrf(tokenHash: string, presented: string | undefined): boolean {
    if (!presented) return false;
    const expected = Buffer.from(this.csrfTokenFor(tokenHash));
    const actual = Buffer.from(presented);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

export const guestVerificationRequired = () =>
  new ProblemException(
    403,
    'GUEST_VERIFICATION_REQUIRED',
    'Verification required',
    'Confirm the code we emailed you to continue.',
  );

@Injectable()
export class GuestGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: GuestSessions,
    private readonly db: TenantDb,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<GuestRouteOptions | undefined>(GUEST_ROUTE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!options) return true; // staff route
    if (!options.session) return true; // e.g. link exchange

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const token = req.cookies[this.sessions.cookieName];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw Problems.unauthenticated();
    const tokenHash = sha256(token);

    const session = await this.db.runWithGuestToken({ guestSessionHash: tokenHash }, (tx) =>
      tx.guestSession.findUnique({ where: { tokenHash } }),
    );
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      throw Problems.unauthenticated();

    const csrf = req.headers['x-csrf-token'];
    if (
      !SAFE_METHODS.has(req.method) &&
      !this.sessions.verifyCsrf(tokenHash, typeof csrf === 'string' ? csrf : undefined)
    ) {
      throw Problems.csrf();
    }

    // Trusted tenant context: taken from the session row the token resolved to.
    this.cls.set('organizationId', session.organizationId);
    this.cls.set('propertyId', session.propertyId);
    this.cls.set('guest', {
      sessionId: session.id,
      tokenHash,
      reservationId: session.reservationId,
      reservationRoomId: session.reservationRoomId,
      guestId: session.guestId,
      verified: session.verifiedAt !== null,
    });
    this.cls.set(
      'log',
      this.cls
        .get('log')
        .child({ organizationId: session.organizationId, guestSessionId: session.id }),
    );

    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db.run((tx) =>
        tx.guestSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }),
      );
    }
    if (options.verified && !session.verifiedAt) throw guestVerificationRequired();
    return true;
  }
}
