import { PERMISSIONS, PERMISSION_CODES, ROLE_TEMPLATES } from '@hotel/contracts';
import type { PrismaClient } from './generated/prisma/client.js';

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
