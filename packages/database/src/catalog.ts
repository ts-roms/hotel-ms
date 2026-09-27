import { PERMISSIONS, PERMISSION_CODES, ROLE_TEMPLATES } from '@hotel/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import { withDbContext } from './context.js';

export const FEATURE_FLAGS = [
  { key: 'self_checkin', description: 'Guest self check-in in the guest portal' },
  { key: 'guest_food_ordering', description: 'Guest food and room-service ordering' },
  { key: 'digital_room_key', description: 'Digital room keys through a room access provider' },
  { key: 'multi_currency', description: 'Multi-currency folios and reporting' },
  { key: 'advanced_reports', description: 'Advanced and group-level reports' },
] as const;

/**
 * Synchronizes platform catalogs (permissions, role templates, feature flags) from code.
 * Runs as the schema owner on every deploy; the runtime role cannot write these tables.
 */
export async function syncPlatformCatalog(ownerClient: PrismaClient): Promise<void> {
  await ownerClient.$transaction(async (tx) => {
    for (const code of PERMISSION_CODES) {
      const def = PERMISSIONS[code];
      const data = {
        description: def.description,
        scopes: [...def.scopes],
        sensitive: 'sensitive' in def ? def.sensitive : false,
      };
      await tx.permission.upsert({ where: { code }, create: { code, ...data }, update: data });
    }

    for (const template of ROLE_TEMPLATES) {
      const data = {
        name: template.name,
        description: template.description,
        permissions: [...template.permissions],
      };
      await tx.roleTemplate.upsert({
        where: { key: template.key },
        create: { key: template.key, ...data },
        update: data,
      });
    }

    for (const flag of FEATURE_FLAGS) {
      await tx.featureFlagDefinition.upsert({
        where: { key: flag.key },
        create: { key: flag.key, description: flag.description },
        update: { description: flag.description },
      });
    }
  });
}

/**
 * Adds permissions that a release added to a system template to every organization role
 * still linked to that template (`roles.template_key`). Additive only: permissions an
 * organization removed from its copy are not re-added unless the template newly gained
 * them in a later release, and nothing is ever taken away.
 *
 * Runs as the system role (cross-tenant), which RLS allows to read role ids, insert role
 * permissions and bump grants versions, nothing else. Returns the number of roles changed.
 */
export async function propagateTemplatePermissions(systemClient: PrismaClient): Promise<number> {
  let changedRoles = 0;
  for (const template of ROLE_TEMPLATES) {
    const roles = await systemClient.role.findMany({
      where: { templateKey: template.key },
      select: { id: true, organizationId: true },
    });
    for (const role of roles) {
      // One transaction per role: new permissions and the cache bump land together, so a
      // failed run cannot leave holders with stale cached grants.
      const changed = await systemClient.$transaction(async (tx) => {
        const inserted = await tx.rolePermission.createMany({
          data: template.permissions.map((permissionCode) => ({
            organizationId: role.organizationId,
            roleId: role.id,
            permissionCode,
          })),
          skipDuplicates: true,
        });
        if (inserted.count === 0) return false;
        // Raw SQL: the system role may update grants_version only (not updated_at).
        await tx.$executeRaw`
          UPDATE organization_memberships SET grants_version = grants_version + 1
          WHERE id IN (SELECT membership_id FROM role_assignments WHERE role_id = ${role.id}::uuid)`;
        return true;
      });
      if (changed) changedRoles++;
    }
  }
  return changedRoles;
}

/**
 * Gives existing organizations the role templates added since they were provisioned (new
 * organizations get every template at creation). Additive: a role whose key an
 * organization already uses (e.g. its own custom role) is left alone. Candidates are found
 * with the system role; roles are created in each organization's own tenant context.
 */
export async function addMissingTemplateRoles(
  systemClient: PrismaClient,
  appClient: PrismaClient,
): Promise<number> {
  const existing = await systemClient.role.findMany({
    where: { templateKey: { not: null } },
    select: { organizationId: true, templateKey: true },
  });
  const byOrganization = new Map<string, Set<string>>();
  for (const role of existing) {
    const keys = byOrganization.get(role.organizationId) ?? new Set<string>();
    keys.add(role.templateKey!);
    byOrganization.set(role.organizationId, keys);
  }
  let created = 0;
  for (const [organizationId, keys] of byOrganization) {
    const missing = ROLE_TEMPLATES.filter((t) => !keys.has(t.key));
    if (missing.length === 0) continue;
    created += await withDbContext(appClient, { organizationId, identityId: null }, async (tx) => {
      let count = 0;
      for (const template of missing) {
        const taken = await tx.role.findFirst({
          where: { key: template.key },
          select: { id: true },
        });
        if (taken) continue;
        const role = await tx.role.create({
          data: {
            organizationId,
            key: template.key,
            name: template.name,
            description: template.description,
            templateKey: template.key,
          },
        });
        await tx.rolePermission.createMany({
          data: template.permissions.map((permissionCode) => ({
            organizationId,
            roleId: role.id,
            permissionCode,
          })),
        });
        count++;
      }
      return count;
    });
  }
  return created;
}
