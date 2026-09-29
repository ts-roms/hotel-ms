import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { SessionInfo } from '@hotel/contracts';
import {
  burnPasswordVerification,
  hashPassword,
  passwordNeedsRehash,
  verifyPassword,
} from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { PrismaService, TenantDb } from '../../infrastructure/database.js';
import { RateLimiter } from '../../infrastructure/redis.js';
import { GrantsService } from '../access/grants.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionService } from './session.service.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
    private readonly sessions: SessionService,
    private readonly grants: GrantsService,
    private readonly audit: AuditService,
    private readonly rateLimiter: RateLimiter,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async login(email: string, password: string): Promise<{ token: string; info: SessionInfo }> {
    const ip = this.cls.get('ip') ?? 'unknown';
    const emailKey = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32);
    await this.rateLimiter.consume(`login:ip:${ip}`, 30, 60);
    await this.rateLimiter.consume(`login:email:${emailKey}`, 10, 15 * 60);

    const identity = await this.prisma.platform.identity.findUnique({
      where: { email },
      include: { credential: true },
    });
    const log = this.cls.get('log');

    if (!identity?.credential) {
      await burnPasswordVerification(password);
      log.info({ event: 'auth.login_failed', reason: 'unknown_identity' }, 'login failed');
      throw Problems.invalidCredentials();
    }

    const now = new Date();
    // Same generic error for locked/disabled accounts: responses must not reveal
    // whether an account exists or its state. The account owner is notified out of band.
    if (identity.status !== 'ACTIVE' || (identity.lockedUntil && identity.lockedUntil > now)) {
      await burnPasswordVerification(password);
      log.warn(
        { event: 'auth.login_failed', reason: 'locked_or_disabled', identityId: identity.id },
        'login failed',
      );
      throw Problems.invalidCredentials();
    }

    if (!(await verifyPassword(identity.credential.passwordHash, password))) {
      const failed = identity.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await this.prisma.platform.identity.update({
        where: { id: identity.id },
        data: {
          failedLoginCount: lock ? 0 : failed,
          lockedUntil: lock
            ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000)
            : identity.lockedUntil,
        },
      });
      log.warn(
        {
          event: 'auth.login_failed',
          reason: 'bad_password',
          identityId: identity.id,
          locked: lock,
        },
        'login failed',
      );
      throw Problems.invalidCredentials();
    }

    await this.prisma.platform.identity.update({
      where: { id: identity.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    if (passwordNeedsRehash(identity.credential.passwordHash)) {
      await this.prisma.platform.identityCredential.update({
        where: { identityId: identity.id },
        data: { passwordHash: await hashPassword(password) },
      });
    }

    this.cls.set('identityId', identity.id);
    const memberships = await this.activeMemberships();
    // Auto-select when there is exactly one organization; otherwise the client shows a picker.
    const activeOrganizationId = memberships.length === 1 ? memberships[0]!.organizationId : null;

    const { token, session, tokenHash } = await this.sessions.create({
      identityId: identity.id,
      activeOrganizationId,
      ip: this.cls.get('ip'),
      userAgent: this.cls.get('userAgent'),
    });
    this.cls.set('sessionId', session.id);
    this.cls.set('sessionTokenHash', tokenHash);

    const mfaEnabled =
      (await this.prisma.platform.mfaFactor.count({
        where: { identityId: identity.id, verifiedAt: { not: null } },
      })) > 0;

    if (mfaEnabled) {
      // Password step done; the session stays limited until the second factor.
      log.info(
        { event: 'auth.password_ok_mfa_pending', identityId: identity.id, sessionId: session.id },
        'mfa challenge required',
      );
    } else {
      await this.recordLogin(identity.id, session.id, activeOrganizationId);
    }

    return {
      token,
      info: await this.sessionInfo(activeOrganizationId, { mfaPending: mfaEnabled }),
    };
  }

  /** Audit entry for a completed sign-in (after MFA when enabled). */
  async recordLogin(
    identityId: string,
    sessionId: string,
    organizationId: string | null,
  ): Promise<void> {
    if (organizationId) {
      await this.tenantDb.runWithTrustedContext({ organizationId, identityId }, (tx) =>
        this.audit.record(tx, {
          organizationId,
          action: 'auth.login',
          entityType: 'session',
          entityId: sessionId,
        }),
      );
    }
    this.cls.get('log').info({ event: 'auth.login', identityId, sessionId }, 'login succeeded');
  }

  async logout(): Promise<void> {
    const sessionId = this.cls.get('sessionId');
    if (sessionId) await this.sessions.revoke(sessionId, 'logout');
  }

  async switchOrganization(organizationId: string): Promise<{ token: string; info: SessionInfo }> {
    const memberships = await this.activeMemberships();
    // Not a member (or another tenant's id): same answer as a non-existent organization.
    if (!memberships.some((m) => m.organizationId === organizationId))
      throw Problems.notFound('Organization');

    const identityId = this.cls.get('identityId')!;
    const { token, tokenHash } = await this.sessions.switchOrganization(
      this.cls.get('sessionId')!,
      organizationId,
    );
    this.cls.set('sessionTokenHash', tokenHash);

    await this.tenantDb.runWithTrustedContext({ organizationId, identityId }, (tx) =>
      this.audit.record(tx, {
        organizationId,
        action: 'auth.organization_selected',
        entityType: 'session',
        entityId: this.cls.get('sessionId')!,
      }),
    );
    return { token, info: await this.sessionInfo(organizationId, { mfaPending: false }) };
  }

  async sessionInfo(
    activeOrganizationId: string | null,
    { mfaPending }: { mfaPending: boolean },
  ): Promise<SessionInfo> {
    const identityId = this.cls.get('identityId')!;
    const identity = await this.prisma.platform.identity.findUniqueOrThrow({
      where: { id: identityId },
      select: {
        id: true,
        email: true,
        displayName: true,
        platformRole: true,
        mfaFactors: { where: { verifiedAt: { not: null } }, select: { id: true } },
      },
    });
    // Until the second factor is done, reveal nothing about organizations or access.
    const memberships = mfaPending ? [] : await this.activeMemberships();

    // A session may point at an organization the identity has since lost access to.
    const organizationId =
      activeOrganizationId && memberships.some((m) => m.organizationId === activeOrganizationId)
        ? activeOrganizationId
        : null;

    let grants: SessionInfo['grants'] = [];
    if (organizationId) {
      grants = await this.tenantDb.runWithTrustedContext(
        { organizationId, identityId },
        async (tx) => {
          const membership = await tx.organizationMembership.findUniqueOrThrow({
            where: { organizationId_identityId: { organizationId, identityId } },
            select: { id: true, grantsVersion: true },
          });
          return (await this.grants.load(tx, organizationId, membership)).toJSON();
        },
      );
    }

    return {
      identity: {
        id: identity.id,
        email: identity.email,
        displayName: identity.displayName,
        mfaEnabled: identity.mfaFactors.length > 0,
        // The ops dashboard needs a session that completed two-step verification.
        platformOperator:
          identity.platformRole === 'OPERATOR' &&
          !mfaPending &&
          this.cls.get('mfaVerified') === true,
      },
      mfaPending,
      memberships,
      activeOrganizationId: organizationId,
      grants,
      csrfToken: this.sessions.csrfTokenFor(this.cls.get('sessionTokenHash')!),
    };
  }

  private activeMemberships(): Promise<SessionInfo['memberships']> {
    return this.tenantDb.runAsIdentity(async (tx) => {
      const rows = await tx.organizationMembership.findMany({
        where: {
          identityId: this.cls.get('identityId')!,
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
        },
        select: { organizationId: true, organization: { select: { name: true } } },
        orderBy: { organization: { name: 'asc' } },
      });
      return rows.map((r) => ({
        organizationId: r.organizationId,
        organizationName: r.organization.name,
      }));
    });
  }
}
