import { Injectable } from '@nestjs/common';
import type { InvitationPreview } from '@hotel/contracts';
import { hashPassword } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { RateLimiter } from '../../infrastructure/redis.js';
import { AuditService } from '../audit/audit.service.js';
import { sha256 } from '../auth/password.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

interface OpenInvitation {
  id: string;
  organizationId: string;
  membershipId: string;
  identityId: string;
  email: string;
  organizationName: string;
  requiresPassword: boolean;
}

/**
 * Public (signed-out) side of invitations. The token is the only credential: the
 * database exposes exactly one invitation for a given token hash (RLS policy
 * invitation_by_token), and the organization context is taken from that row.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rateLimiter: RateLimiter,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private async resolve(token: string): Promise<OpenInvitation> {
    await this.rateLimiter.consume(`invitation:ip:${this.cls.get('ip') ?? 'unknown'}`, 30, 15 * 60);
    const invitation = await this.db.runWithInvitationToken(sha256(token), (tx) =>
      tx.organizationInvitation.findUnique({ where: { tokenHash: sha256(token) } }),
    );
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date()
    ) {
      throw Problems.invalidToken();
    }
    // Trusted: the organization id comes from the invitation row, not from the request.
    return this.db.runWithTrustedContext(
      { organizationId: invitation.organizationId, identityId: null },
      async (tx) => {
        const membership = await tx.organizationMembership.findUniqueOrThrow({
          where: { id: invitation.membershipId },
          include: {
            organization: { select: { name: true, status: true } },
            identity: {
              select: { id: true, status: true, credential: { select: { identityId: true } } },
            },
          },
        });
        if (
          membership.status !== 'INVITED' ||
          membership.organization.status !== 'ACTIVE' ||
          membership.identity.status !== 'ACTIVE'
        ) {
          throw Problems.invalidToken();
        }
        return {
          id: invitation.id,
          organizationId: invitation.organizationId,
          membershipId: invitation.membershipId,
          identityId: membership.identity.id,
          email: invitation.email,
          organizationName: membership.organization.name,
          requiresPassword: !membership.identity.credential,
        };
      },
    );
  }

  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.resolve(token);
    return {
      organizationName: invitation.organizationName,
      email: invitation.email,
      requiresPassword: invitation.requiresPassword,
    };
  }

  async accept(token: string, password: string | undefined): Promise<void> {
    const invitation = await this.resolve(token);
    if (invitation.requiresPassword && !password) {
      throw Problems.validation([
        { path: 'password', message: 'Choose a password to create your account' },
      ]);
    }
    const passwordHash = invitation.requiresPassword ? await hashPassword(password!) : null;

    // The invitee is the actor of this signed-out request.
    this.cls.set('identityId', invitation.identityId);
    this.cls.set('organizationId', invitation.organizationId);

    await this.db.run(async (tx) => {
      const claimed = await tx.organizationInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw Problems.invalidToken();

      if (passwordHash) {
        // create (not upsert): a concurrent acceptance that already set a password wins.
        await tx.identityCredential.create({
          data: { identityId: invitation.identityId, passwordHash },
        });
      }
      await tx.organizationMembership.update({
        where: { id: invitation.membershipId },
        data: { status: 'ACTIVE', joinedAt: new Date(), grantsVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'member.joined',
        entityType: 'membership',
        entityId: invitation.membershipId,
      });
      await this.outbox.enqueue(tx, 'MemberJoined', {
        membershipId: invitation.membershipId,
        identityId: invitation.identityId,
      });
    });
  }
}
