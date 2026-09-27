import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Session } from '@hotel/database';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../../infrastructure/database.js';

/** Refresh last_seen/idle expiry at most this often, to avoid a write per request. */
const TOUCH_INTERVAL_MS = 60_000;

export interface ResolvedSession {
  session: Session;
  tokenHash: string;
}

/**
 * Opaque server-side sessions (ADR-0006). The browser holds a random 256-bit token; the
 * database holds only its SHA-256, so a database leak does not yield usable sessions.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get cookieName(): string {
    return this.env.COOKIE_SECURE ? '__Host-hotel_sid' : 'hotel_sid';
  }

  cookieOptions() {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: this.env.SESSION_ABSOLUTE_DAYS * 24 * 60 * 60,
    };
  }

  async create(input: {
    identityId: string;
    activeOrganizationId: string | null;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{ token: string; session: Session; tokenHash: string }> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const now = Date.now();
    const session = await this.prisma.platform.session.create({
      data: {
        tokenHash,
        identityId: input.identityId,
        activeOrganizationId: input.activeOrganizationId,
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        idleExpiresAt: new Date(now + this.env.SESSION_IDLE_MINUTES * 60_000),
        absoluteExpiresAt: new Date(now + this.env.SESSION_ABSOLUTE_DAYS * 86_400_000),
      },
    });
    return { token, session, tokenHash };
  }

  /** Returns null for unknown, revoked, expired sessions or disabled identities. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const tokenHash = hashToken(token);
    const session = await this.prisma.platform.session.findUnique({
      where: { tokenHash },
      include: { identity: { select: { status: true } } },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.realm !== 'STAFF' ||
      session.identity.status !== 'ACTIVE' ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now
    ) {
      return null;
    }

    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.platform.session.update({
        where: { id: session.id },
        data: {
          lastSeenAt: now,
          idleExpiresAt: new Date(now.getTime() + this.env.SESSION_IDLE_MINUTES * 60_000),
        },
      });
    }
    const { identity: _identity, ...plain } = session;
    return { session: plain, tokenHash };
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.platform.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /**
   * Changes the active organization and rotates the token (privilege change), which also
   * invalidates the old CSRF token.
   */
  async switchOrganization(
    sessionId: string,
    organizationId: string,
  ): Promise<{ token: string; tokenHash: string }> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    await this.prisma.platform.session.update({
      where: { id: sessionId },
      data: { tokenHash, activeOrganizationId: organizationId },
    });
    return { token, tokenHash };
  }

  /** CSRF token bound to the session token (double-submit via X-CSRF-Token header). */
  csrfTokenFor(tokenHash: string): string {
    return createHmac('sha256', this.env.SESSION_SECRET)
      .update(`csrf:${tokenHash}`)
      .digest('base64url');
  }

  verifyCsrf(tokenHash: string, presented: string | undefined): boolean {
    if (!presented) return false;
    const expected = Buffer.from(this.csrfTokenFor(tokenHash));
    const actual = Buffer.from(presented);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  isAllowedOrigin(origin: string | undefined): boolean {
    // Non-browser clients send no Origin; they cannot ride a victim's cookies anyway.
    return origin === undefined || this.env.WEB_ORIGIN.includes(origin);
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
