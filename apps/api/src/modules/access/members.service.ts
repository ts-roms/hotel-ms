import { Inject, Injectable } from '@nestjs/common';
import type {
  AssignmentRequest,
  InviteMemberRequest,
  Member,
  PermissionCode,
  UpdateMemberRequest,
} from '@hotel/contracts';
import { Prisma, type Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { newToken, sha256 } from '../../common/crypto.js';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { ENV, type Env } from '../../config/env.js';
import { TenantDb } from '../../infrastructure/database.js';
import { NotificationsQueue } from '../../infrastructure/queue.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import {
  assertAdministratorRemains,
  bumpGrantsVersion,
  lockOrganization,
} from './access-guards.js';
import { canGrantRole, coversMember, type ScopeTarget } from './access-policy.js';

const INVITATION_DAYS = 7;

const memberInclude = {
  identity: {
    select: {
      email: true,
      displayName: true,
      _count: { select: { mfaFactors: { where: { verifiedAt: { not: null } } } } },
    },
  },
  roleAssignments: {
    include: { role: { select: { key: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.OrganizationMembershipInclude;

type MemberRow = Prisma.OrganizationMembershipGetPayload<{ include: typeof memberInclude }>;

function toDto(row: MemberRow): Member {
  return {
    membershipId: row.id,
    identityId: row.identityId,
    email: row.identity.email,
    displayName: row.identity.displayName,
    status: row.status,
    mfaEnabled: row.identity._count.mfaFactors > 0,
    joinedAt: row.joinedAt?.toISOString() ?? null,
    assignments: row.roleAssignments.map((a) => ({
      id: a.id,
      roleId: a.roleId,
      roleKey: a.role.key,
      roleName: a.role.name,
      scopeType: a.scopeType,
      propertyId: a.propertyId,
    })),
  };
}

const scopesOf = (row: {
  roleAssignments: { scopeType: 'ORGANIZATION' | 'PROPERTY'; propertyId: string | null }[];
}): ScopeTarget[] =>
  row.roleAssignments.map((a) => ({ scopeType: a.scopeType, propertyId: a.propertyId }));

const targetOf = (a: AssignmentRequest): ScopeTarget =>
  a.propertyId
    ? { scopeType: 'PROPERTY', propertyId: a.propertyId }
    : { scopeType: 'ORGANIZATION', propertyId: null };

@Injectable()
export class MembersService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsQueue,
    private readonly cls: ClsService<RequestContext>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get grants() {
    return this.cls.get('grants')!;
  }

  /** Property-scoped viewers see members holding a role at one of their properties. */
  private visibilityFilter(permission: PermissionCode): Prisma.OrganizationMembershipWhereInput {
    const scope = this.grants.propertyScope(permission);
    return scope.kind === 'all'
      ? {}
      : { roleAssignments: { some: { propertyId: { in: scope.propertyIds } } } };
  }

  async list(): Promise<Member[]> {
    const rows = await this.db.run((tx) =>
      tx.organizationMembership.findMany({
        where: { status: { not: 'REMOVED' }, ...this.visibilityFilter('member.read') },
        include: memberInclude,
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map(toDto);
  }

  async get(membershipId: string): Promise<Member> {
    const row = await this.db.run((tx) => this.findVisible(tx, membershipId, 'member.read'));
    return toDto(row);
  }

  private async findVisible(
    tx: Tx,
    membershipId: string,
    permission: PermissionCode,
  ): Promise<MemberRow> {
    const row = await tx.organizationMembership.findFirst({
      where: { id: membershipId, ...this.visibilityFilter(permission) },
      include: memberInclude,
    });
    if (!row) throw Problems.notFound('Member');
    return row;
  }

  /** Granting access is a sensitive action even when reached through member.invite. */
  private requireMfa(): void {
    if (!this.cls.get('mfaVerified')) throw Problems.mfaEnrollmentRequired('role.assign');
  }

  private async checkGrantable(
    tx: Tx,
    assignments: AssignmentRequest[],
    alsoRequire?: PermissionCode,
  ) {
    const roles = await tx.role.findMany({
      where: { id: { in: [...new Set(assignments.map((a) => a.roleId))] } },
      include: { permissions: { select: { permissionCode: true } } },
    });
    const propertyIds = [
      ...new Set(assignments.map((a) => a.propertyId).filter((id): id is string => !!id)),
    ];
    const knownProperties = await tx.property.count({ where: { id: { in: propertyIds } } });
    if (knownProperties !== propertyIds.length) {
      throw Problems.validation([{ path: 'assignments', message: 'Unknown property' }]);
    }

    for (const assignment of assignments) {
      const role = roles.find((r) => r.id === assignment.roleId);
      if (!role) throw Problems.validation([{ path: 'assignments', message: 'Unknown role' }]);
      const target = targetOf(assignment);
      if (alsoRequire && !coversMember(this.grants, alsoRequire, [target])) {
        throw Problems.forbidden(`Missing ${alsoRequire} for this scope`);
      }
      const decision = canGrantRole(
        this.grants,
        role.permissions.map((p) => p.permissionCode),
        target,
      );
      if (!decision.ok) throw Problems.forbidden(decision.reason);
    }
    return roles;
  }

  async invite(input: InviteMemberRequest): Promise<Member> {
    this.requireMfa();
    const organizationId = this.cls.get('organizationId')!;
    const actorId = this.cls.get('identityId')!;
    const token = newToken();

    const { member, organizationName, inviterName } = await this.db.run(async (tx) => {
      await lockOrganization(tx, organizationId);
      await this.checkGrantable(tx, input.assignments, 'member.invite');

      // Identities are global; an existing person keeps their name and credentials.
      const identity =
        (await tx.identity.findUnique({ where: { email: input.email } })) ??
        (await tx.identity.create({
          data: { email: input.email, displayName: input.displayName },
        }));

      const existing = await tx.organizationMembership.findUnique({
        where: { organizationId_identityId: { organizationId, identityId: identity.id } },
      });
      if (existing) throw Problems.conflict('This person is already a member of the organization.');

      const membership = await tx.organizationMembership.create({
        data: {
          organizationId,
          identityId: identity.id,
          status: 'INVITED',
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      for (const assignment of input.assignments) {
        const created = await tx.roleAssignment.create({
          data: {
            organizationId,
            membershipId: membership.id,
            roleId: assignment.roleId,
            scopeType: assignment.propertyId ? 'PROPERTY' : 'ORGANIZATION',
            propertyId: assignment.propertyId,
            createdBy: actorId,
          },
        });
        await this.outbox.enqueue(tx, 'RoleAssigned', {
          membershipId: membership.id,
          assignmentId: created.id,
          roleId: assignment.roleId,
          propertyId: assignment.propertyId,
        });
      }
      await tx.organizationInvitation.create({
        data: {
          organizationId,
          membershipId: membership.id,
          email: identity.email,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
          createdBy: actorId,
        },
      });
      await this.audit.record(tx, {
        action: 'member.invited',
        entityType: 'membership',
        entityId: membership.id,
        after: {
          email: identity.email,
          assignments: input.assignments,
        } as unknown as Prisma.InputJsonValue,
      });
      await this.outbox.enqueue(tx, 'MemberInvited', {
        membershipId: membership.id,
        identityId: identity.id,
      });

      const [org, inviter] = await Promise.all([
        tx.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { name: true },
        }),
        tx.identity.findUniqueOrThrow({ where: { id: actorId }, select: { displayName: true } }),
      ]);
      const row = await tx.organizationMembership.findUniqueOrThrow({
        where: { id: membership.id },
        include: memberInclude,
      });
      return { member: toDto(row), organizationName: org.name, inviterName: inviter.displayName };
    });

    await this.sendInvitation(member, organizationName, inviterName, token);
    return member;
  }

  async resendInvitation(membershipId: string): Promise<void> {
    this.requireMfa();
    const organizationId = this.cls.get('organizationId')!;
    const actorId = this.cls.get('identityId')!;
    const token = newToken();

    const { member, organizationName, inviterName } = await this.db.run(async (tx) => {
      const row = await this.findVisible(tx, membershipId, 'member.invite');
      if (!coversMember(this.grants, 'member.invite', scopesOf(row)))
        throw Problems.notFound('Member');
      if (row.status !== 'INVITED') throw Problems.conflict('This member has already joined.');
      const now = new Date();
      await tx.organizationInvitation.updateMany({
        where: { membershipId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.organizationInvitation.create({
        data: {
          organizationId,
          membershipId,
          email: row.identity.email,
          tokenHash: sha256(token),
          expiresAt: new Date(now.getTime() + INVITATION_DAYS * 86_400_000),
          createdBy: actorId,
        },
      });
      await this.audit.record(tx, {
        action: 'member.invitation_resent',
        entityType: 'membership',
        entityId: membershipId,
      });
      const [org, inviter] = await Promise.all([
        tx.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { name: true },
        }),
        tx.identity.findUniqueOrThrow({ where: { id: actorId }, select: { displayName: true } }),
      ]);
      return { member: toDto(row), organizationName: org.name, inviterName: inviter.displayName };
    });
    await this.sendInvitation(member, organizationName, inviterName, token);
  }

  private async sendInvitation(
    member: Member,
    organizationName: string,
    inviterName: string,
    token: string,
  ) {
    await this.notifications.sendEmail({
      template: 'member-invitation',
      to: member.email,
      data: {
        displayName: member.displayName,
        organizationName,
        inviterName,
        acceptUrl: `${this.env.APP_PUBLIC_URL}/accept-invitation#token=${token}`,
        expiresInDays: INVITATION_DAYS,
      },
    });
  }

  async updateStatus(membershipId: string, input: UpdateMemberRequest): Promise<Member> {
    const organizationId = this.cls.get('organizationId')!;
    if (membershipId === this.cls.get('membershipId')) {
      throw Problems.forbidden('You cannot change your own membership status.');
    }
    return this.db.run(async (tx) => {
      await lockOrganization(tx, organizationId);
      const row = await this.findVisible(tx, membershipId, 'member.update');
      if (!coversMember(this.grants, 'member.update', scopesOf(row))) {
        throw Problems.forbidden('This member has access outside your scope.');
      }
      if (row.status === 'INVITED' || row.status === 'REMOVED') {
        throw Problems.conflict(
          `A ${row.status.toLowerCase()} member cannot be ${input.status.toLowerCase()}.`,
        );
      }
      if (row.status === input.status) return toDto(row);

      await tx.organizationMembership.update({
        where: { id: membershipId },
        data: { status: input.status, updatedBy: this.cls.get('identityId') },
      });
      await bumpGrantsVersion(tx, [membershipId]);
      if (input.status === 'SUSPENDED') await assertAdministratorRemains(tx);

      await this.audit.record(tx, {
        action: 'member.status_changed',
        entityType: 'membership',
        entityId: membershipId,
        before: { status: row.status },
        after: { status: input.status },
      });
      await this.outbox.enqueue(tx, 'MemberStatusChanged', { membershipId, status: input.status });
      return toDto(
        await tx.organizationMembership.findUniqueOrThrow({
          where: { id: membershipId },
          include: memberInclude,
        }),
      );
    });
  }

  async addAssignment(membershipId: string, input: AssignmentRequest): Promise<Member> {
    this.requireMfa();
    const organizationId = this.cls.get('organizationId')!;
    try {
      return await this.db.run(async (tx) => {
        await lockOrganization(tx, organizationId);
        const row = await this.findVisible(tx, membershipId, 'role.read');
        if (row.status === 'REMOVED') throw Problems.conflict('Member has been removed.');
        await this.checkGrantable(tx, [input]);

        const created = await tx.roleAssignment.create({
          data: {
            organizationId,
            membershipId,
            roleId: input.roleId,
            scopeType: input.propertyId ? 'PROPERTY' : 'ORGANIZATION',
            propertyId: input.propertyId,
            createdBy: this.cls.get('identityId'),
          },
        });
        await bumpGrantsVersion(tx, [membershipId]);
        await this.audit.record(tx, {
          action: 'role.assigned',
          entityType: 'membership',
          entityId: membershipId,
          propertyId: input.propertyId,
          after: { assignmentId: created.id, roleId: input.roleId, propertyId: input.propertyId },
        });
        await this.outbox.enqueue(
          tx,
          'RoleAssigned',
          {
            membershipId,
            assignmentId: created.id,
            roleId: input.roleId,
            propertyId: input.propertyId,
          },
          { propertyId: input.propertyId },
        );
        return toDto(
          await tx.organizationMembership.findUniqueOrThrow({
            where: { id: membershipId },
            include: memberInclude,
          }),
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw Problems.conflict('The member already has this role at this scope.');
      }
      throw error;
    }
  }

  async removeAssignment(membershipId: string, assignmentId: string): Promise<Member> {
    this.requireMfa();
    const organizationId = this.cls.get('organizationId')!;
    return this.db.run(async (tx) => {
      await lockOrganization(tx, organizationId);
      await this.findVisible(tx, membershipId, 'role.read');
      const assignment = await tx.roleAssignment.findFirst({
        where: { id: assignmentId, membershipId },
        include: { role: { include: { permissions: { select: { permissionCode: true } } } } },
      });
      if (!assignment) throw Problems.notFound('Role assignment');

      // You may only take away what you could have given.
      const decision = canGrantRole(
        this.grants,
        assignment.role.permissions.map((p) => p.permissionCode),
        { scopeType: assignment.scopeType, propertyId: assignment.propertyId },
      );
      if (!decision.ok) throw Problems.forbidden(decision.reason);

      await tx.roleAssignment.delete({ where: { id: assignmentId } });
      await bumpGrantsVersion(tx, [membershipId]);
      await assertAdministratorRemains(tx);

      await this.audit.record(tx, {
        action: 'role.unassigned',
        entityType: 'membership',
        entityId: membershipId,
        propertyId: assignment.propertyId,
        before: { assignmentId, roleId: assignment.roleId, propertyId: assignment.propertyId },
      });
      await this.outbox.enqueue(
        tx,
        'RoleUnassigned',
        {
          membershipId,
          assignmentId,
          roleId: assignment.roleId,
          propertyId: assignment.propertyId,
        },
        { propertyId: assignment.propertyId },
      );
      return toDto(
        await tx.organizationMembership.findUniqueOrThrow({
          where: { id: membershipId },
          include: memberInclude,
        }),
      );
    });
  }
}
