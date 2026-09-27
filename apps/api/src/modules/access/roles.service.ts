import { Injectable } from '@nestjs/common';
import type { CreateRoleRequest, RoleDto, UpdateRoleRequest } from '@hotel/contracts';
import { Prisma, type Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import {
  assertAdministratorRemains,
  bumpGrantsVersion,
  lockOrganization,
} from './access-guards.js';
import { canDefineRole } from './access-policy.js';

const roleInclude = {
  permissions: { select: { permissionCode: true }, orderBy: { permissionCode: 'asc' } },
  _count: { select: { assignments: true } },
} satisfies Prisma.RoleInclude;

type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

function toDto(row: RoleRow): RoleDto {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    templateKey: row.templateKey,
    permissions: row.permissions.map((p) => p.permissionCode),
    assignmentCount: row._count.assignments,
    version: row.version,
  };
}

@Injectable()
export class RolesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async list(): Promise<RoleDto[]> {
    const rows = await this.db.run((tx) =>
      tx.role.findMany({ include: roleInclude, orderBy: { name: 'asc' } }),
    );
    return rows.map(toDto);
  }

  async get(roleId: string): Promise<RoleDto> {
    const row = await this.db.run((tx) =>
      tx.role.findUnique({ where: { id: roleId }, include: roleInclude }),
    );
    if (!row) throw Problems.notFound('Role');
    return toDto(row);
  }

  async create(input: CreateRoleRequest): Promise<RoleDto> {
    const decision = canDefineRole(this.cls.get('grants')!, input.permissions);
    if (!decision.ok) throw Problems.forbidden(decision.reason);
    const organizationId = this.cls.get('organizationId')!;
    const actorId = this.cls.get('identityId') ?? null;
    try {
      return await this.db.run(async (tx) => {
        const role = await tx.role.create({
          data: {
            organizationId,
            key: input.key,
            name: input.name,
            description: input.description,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
        await tx.rolePermission.createMany({
          data: [...new Set(input.permissions)].map((permissionCode) => ({
            organizationId,
            roleId: role.id,
            permissionCode,
          })),
        });
        const row = await tx.role.findUniqueOrThrow({
          where: { id: role.id },
          include: roleInclude,
        });
        await this.audit.record(tx, {
          action: 'role.created',
          entityType: 'role',
          entityId: role.id,
          after: { key: row.key, name: row.name, permissions: toDto(row).permissions },
        });
        await this.outbox.enqueue(tx, 'RoleCreated', { roleId: role.id, key: role.key });
        return toDto(row);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw Problems.conflict(`A role with key "${input.key}" already exists.`);
      }
      throw error;
    }
  }

  /**
   * Adding permissions requires holding them organization-wide (anti-escalation). Every
   * member holding the role gets fresh grants on their next request.
   */
  async update(
    roleId: string,
    expectedVersion: number,
    input: UpdateRoleRequest,
  ): Promise<RoleDto> {
    const organizationId = this.cls.get('organizationId')!;
    return this.db.run(async (tx) => {
      await lockOrganization(tx, organizationId);
      const before = await tx.role.findUnique({ where: { id: roleId }, include: roleInclude });
      if (!before) throw Problems.notFound('Role');
      if (before.version !== expectedVersion) throw Problems.versionConflict();

      const beforePermissions = before.permissions.map((p) => p.permissionCode);
      const nextPermissions = input.permissions
        ? [...new Set(input.permissions)].sort()
        : beforePermissions;
      const added = nextPermissions.filter((p) => !beforePermissions.includes(p));
      const decision = canDefineRole(this.cls.get('grants')!, added);
      if (!decision.ok) throw Problems.forbidden(decision.reason);

      await tx.role.update({
        where: { id: roleId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedBy: this.cls.get('identityId') ?? null,
          version: { increment: 1 },
        },
      });
      const permissionsChanged =
        input.permissions !== undefined &&
        added.length + beforePermissions.filter((p) => !nextPermissions.includes(p)).length > 0;
      if (permissionsChanged) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: nextPermissions.map((permissionCode) => ({
            organizationId,
            roleId,
            permissionCode,
          })),
        });
        await this.invalidateHolders(tx, roleId);
        await assertAdministratorRemains(tx);
      }

      const after = await tx.role.findUniqueOrThrow({
        where: { id: roleId },
        include: roleInclude,
      });
      const changedFields = [
        ...(before.name !== after.name ? ['name'] : []),
        ...(before.description !== after.description ? ['description'] : []),
        ...(permissionsChanged ? ['permissions'] : []),
      ];
      if (changedFields.length > 0) {
        await this.audit.record(tx, {
          action: 'role.updated',
          entityType: 'role',
          entityId: roleId,
          before: {
            name: before.name,
            description: before.description,
            permissions: beforePermissions,
          },
          after: { name: after.name, description: after.description, permissions: nextPermissions },
        });
        await this.outbox.enqueue(tx, 'RoleUpdated', { roleId, changedFields });
      }
      return toDto(after);
    });
  }

  async delete(roleId: string): Promise<void> {
    const organizationId = this.cls.get('organizationId')!;
    await this.db.run(async (tx) => {
      await lockOrganization(tx, organizationId);
      const role = await tx.role.findUnique({ where: { id: roleId }, include: roleInclude });
      if (!role) throw Problems.notFound('Role');
      if (role._count.assignments > 0) {
        throw Problems.conflict('Remove this role from all members before deleting it.');
      }
      await tx.role.delete({ where: { id: roleId } });
      await this.audit.record(tx, {
        action: 'role.deleted',
        entityType: 'role',
        entityId: roleId,
        before: { key: role.key, name: role.name, permissions: toDto(role).permissions },
      });
      await this.outbox.enqueue(tx, 'RoleDeleted', { roleId, key: role.key });
    });
  }

  private async invalidateHolders(tx: Tx, roleId: string): Promise<void> {
    const holders = await tx.roleAssignment.findMany({
      where: { roleId },
      select: { membershipId: true },
    });
    await bumpGrantsVersion(tx, [...new Set(holders.map((h) => h.membershipId))]);
  }
}
