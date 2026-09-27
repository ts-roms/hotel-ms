import { ROLE_TEMPLATES } from '@hotel/contracts';
import { v7 as uuidv7 } from 'uuid';
import type { PrismaClient } from './generated/prisma/client.js';
import { withDbContext, type Tx } from './context.js';

export interface ProvisionOrganizationInput {
  name: string;
  slug: string;
  defaultLocale: string;
  defaultCurrency: string;
  defaultTimezone: string;
  /** Identity that becomes the first organization administrator. */
  adminIdentityId: string;
  /** Who performed the provisioning (platform operator or system). */
  actorIdentityId: string | null;
}

/**
 * Creates an organization with a copy of every system role template and grants the
 * initial administrator org_admin at organization scope. Runs as the runtime role inside
 * the new organization's RLS context, the same path every tenant write takes.
 */
export async function provisionOrganization(
  prisma: PrismaClient,
  input: ProvisionOrganizationInput,
): Promise<{ organizationId: string; roleIdsByKey: Map<string, string> }> {
  const organizationId = uuidv7();
  return withDbContext(
    prisma,
    { organizationId, identityId: input.actorIdentityId },
    async (tx) => {
      await tx.organization.create({
        data: {
          id: organizationId,
          name: input.name,
          slug: input.slug,
          defaultLocale: input.defaultLocale,
          defaultCurrency: input.defaultCurrency,
          defaultTimezone: input.defaultTimezone,
          createdBy: input.actorIdentityId,
          updatedBy: input.actorIdentityId,
        },
      });

      const roleIdsByKey = await cloneRoleTemplates(tx, organizationId, input.actorIdentityId);

      const membership = await tx.organizationMembership.create({
        data: {
          organizationId,
          identityId: input.adminIdentityId,
          status: 'ACTIVE',
          joinedAt: new Date(),
          createdBy: input.actorIdentityId,
        },
      });
      await tx.roleAssignment.create({
        data: {
          organizationId,
          membershipId: membership.id,
          roleId: roleIdsByKey.get('org_admin')!,
          scopeType: 'ORGANIZATION',
          createdBy: input.actorIdentityId,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          actorType: input.actorIdentityId ? 'PLATFORM_OPERATOR' : 'SYSTEM',
          actorId: input.actorIdentityId,
          action: 'organization.provisioned',
          entityType: 'organization',
          entityId: organizationId,
          after: { name: input.name, slug: input.slug, adminIdentityId: input.adminIdentityId },
        },
      });

      return { organizationId, roleIdsByKey };
    },
  );
}

async function cloneRoleTemplates(
  tx: Tx,
  organizationId: string,
  actorIdentityId: string | null,
): Promise<Map<string, string>> {
  const roleIdsByKey = new Map<string, string>();
  for (const template of ROLE_TEMPLATES) {
    const role = await tx.role.create({
      data: {
        organizationId,
        key: template.key,
        name: template.name,
        description: template.description,
        templateKey: template.key,
        createdBy: actorIdentityId,
        updatedBy: actorIdentityId,
      },
    });
    await tx.rolePermission.createMany({
      data: template.permissions.map((permissionCode) => ({
        organizationId,
        roleId: role.id,
        permissionCode,
      })),
    });
    roleIdsByKey.set(template.key, role.id);
  }
  return roleIdsByKey;
}
