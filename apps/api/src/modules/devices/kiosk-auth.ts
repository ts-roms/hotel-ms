import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ENV, type Env } from '../../config/env.js';
import { TenantDb } from '../../infrastructure/database.js';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** An operator is signed out after this long without a request… */
export const OPERATOR_IDLE_MS = 30 * 60_000;
/** …and after this long in any case (one shift). */
export const OPERATOR_MAX_MS = 12 * 3_600_000;
const TOUCH_INTERVAL_MS = 60_000;

export interface ResolvedDevice {
  id: string;
  organizationId: string;
  propertyId: string;
  name: string;
  permissions: string[];
  tokenHash: string;
}

export interface ResolvedOperator {
  sessionId: string;
  membershipId: string;
  identityId: string;
  expiresAt: Date;
}

/**
 * Shared-device credentials (ADR-0020). Two cookies:
 * - the **device** cookie: long-lived, set once at pairing, identifies the tablet;
 * - the **operator** cookie: a short session for the staff member signed in on it.
 * Both are opaque tokens; only their SHA-256 is stored. CSRF tokens are derived from the
 * device token, so every write needs both the cookie and the page's token.
 */
@Injectable()
export class KioskAuth {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: TenantDb,
  ) {}

  get deviceCookie(): string {
    return this.env.COOKIE_SECURE ? '__Host-hotel_device' : 'hotel_device';
  }

  get operatorCookie(): string {
    return this.env.COOKIE_SECURE ? '__Host-hotel_kiosk' : 'hotel_kiosk';
  }

  cookieOptions(expires: Date) {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'strict' as const,
      path: '/',
      expires,
    };
  }

  csrfTokenFor(deviceTokenHash: string): string {
    return createHmac('sha256', this.env.SESSION_SECRET)
      .update(`kiosk-csrf:${deviceTokenHash}`)
      .digest('base64url');
  }

  verifyCsrf(deviceTokenHash: string, presented: unknown): boolean {
    if (typeof presented !== 'string') return false;
    const expected = Buffer.from(this.csrfTokenFor(deviceTokenHash));
    const actual = Buffer.from(presented);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** Does the request carry device credentials at all (so the staff session is absent)? */
  hasDeviceCookie(req: FastifyRequest): boolean {
    return typeof req.cookies[this.deviceCookie] === 'string';
  }

  hasOperatorCookie(req: FastifyRequest): boolean {
    return typeof req.cookies[this.operatorCookie] === 'string';
  }

  /** The paired, unrevoked device behind the device cookie, or null. */
  async device(req: FastifyRequest): Promise<ResolvedDevice | null> {
    const token = req.cookies[this.deviceCookie];
    if (!token || !TOKEN_RE.test(token)) return null;
    const tokenHash = sha256(token);
    const device = await this.db.runWithDeviceToken(tokenHash, (tx) =>
      tx.device.findUnique({ where: { tokenHash } }),
    );
    if (!device || device.revokedAt) return null;
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db.runWithTrustedContext(
        { organizationId: device.organizationId, identityId: null },
        (tx) => tx.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }),
      );
    }
    return {
      id: device.id,
      organizationId: device.organizationId,
      propertyId: device.propertyId,
      name: device.name,
      permissions: device.permissions,
      tokenHash,
    };
  }

  /** The live operator session on this device, or null (expired, idle, ended, other device). */
  async operator(req: FastifyRequest, device: ResolvedDevice): Promise<ResolvedOperator | null> {
    const token = req.cookies[this.operatorCookie];
    if (!token || !TOKEN_RE.test(token)) return null;
    const tokenHash = sha256(token);
    return this.db.runWithTrustedContext(
      { organizationId: device.organizationId, identityId: null },
      async (tx) => {
        const session = await tx.deviceSession.findUnique({
          where: { tokenHash },
          include: { membership: { select: { identityId: true, status: true } } },
        });
        const now = Date.now();
        if (
          !session ||
          session.deviceId !== device.id ||
          session.endedAt ||
          session.expiresAt.getTime() <= now ||
          now - session.lastSeenAt.getTime() > OPERATOR_IDLE_MS ||
          session.membership.status !== 'ACTIVE'
        ) {
          return null;
        }
        if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
          await tx.deviceSession.update({
            where: { id: session.id },
            data: { lastSeenAt: new Date(now) },
          });
        }
        return {
          sessionId: session.id,
          membershipId: session.membershipId,
          identityId: session.membership.identityId,
          expiresAt: session.expiresAt,
        };
      },
    );
  }
}
