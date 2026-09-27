import type { PrismaClient } from './generated/prisma/client.js';
import { withDbContext } from './context.js';
import { DEMO_INVENTORY, type DemoInventory, seedDemoInventory } from './demo-pms.js';
import { hashPassword } from './password.js';
import { provisionOrganization } from './provisioning.js';

/**
 * Development/test-only password for every demo identity. Never used outside local
 * development, CI and ephemeral test environments; `seedDemoWorld` refuses to run when
 * NODE_ENV=production.
 */
export const DEMO_PASSWORD = 'Hotel-Dev-2026!';

interface DemoPropertySpec {
  code: string;
  name: string;
  city: string;
  timezone: string;
  currency: string;
  countryCode: string;
}

export interface DemoWorld {
  abc: {
    organizationId: string;
    properties: Record<'MNL' | 'CEB' | 'DVO', string>;
  };
  xyz: {
    organizationId: string;
    properties: Record<'BOR', string>;
  };
  /** Identity email → identity id */
  identities: Record<string, string>;
  /** Room types, rooms and rate plans per property code. */
  inventory: Record<'MNL' | 'CEB' | 'DVO' | 'BOR', DemoInventory>;
}

/**
 * Two unrelated organizations (spec §2/§4 examples) with users covering the scope cases
 * the isolation suite checks:
 *
 *   ABC Hospitality Group: Manila, Cebu, Davao
 *     admin@abc.test         org_admin        @ ORGANIZATION
 *     john.gm@abc.test       general_manager  @ PROPERTY(MNL)
 *     maria.hr@abc.test      auditor          @ PROPERTY(MNL), PROPERTY(CEB)
 *     robert.finance@abc.test auditor         @ ORGANIZATION
 *     frontdesk@abc.test     staff            @ PROPERTY(CEB)
 *     reception@abc.test     front_desk       @ PROPERTY(MNL)
 *     hk@abc.test            housekeeper      @ PROPERTY(MNL)
 *   XYZ Resorts: Boracay
 *     admin@xyz.test         org_admin        @ ORGANIZATION
 *   consultant@shared.test   auditor          @ ORGANIZATION in both (multi-org identity)
 */
export async function seedDemoWorld(prisma: PrismaClient): Promise<DemoWorld> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data in production');
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const identities: Record<string, string> = {};
  const identity = async (email: string, displayName: string) => {
    const created = await prisma.identity.create({
      data: { email, displayName, credential: { create: { passwordHash } } },
    });
    identities[email] = created.id;
    return created.id;
  };

  const abcAdmin = await identity('admin@abc.test', 'Ana Admin');
  const john = await identity('john.gm@abc.test', 'John Reyes');
  const maria = await identity('maria.hr@abc.test', 'Maria Santos');
  const robert = await identity('robert.finance@abc.test', 'Robert Cruz');
  const frontDesk = await identity('frontdesk@abc.test', 'Faye Desk');
  const reception = await identity('reception@abc.test', 'Rey Reception');
  const housekeeper = await identity('hk@abc.test', 'Hana Housekeeper');
  const xyzAdmin = await identity('admin@xyz.test', 'Xavier Admin');
  const consultant = await identity('consultant@shared.test', 'Casey Consultant');

  const abc = await provisionOrganization(prisma, {
    name: 'ABC Hospitality Group',
    slug: 'abc-hospitality',
    defaultLocale: 'en-PH',
    defaultCurrency: 'PHP',
    defaultTimezone: 'Asia/Manila',
    adminIdentityId: abcAdmin,
    actorIdentityId: null,
  });
  const xyz = await provisionOrganization(prisma, {
    name: 'XYZ Resorts',
    slug: 'xyz-resorts',
    defaultLocale: 'en-PH',
    defaultCurrency: 'PHP',
    defaultTimezone: 'Asia/Manila',
    adminIdentityId: xyzAdmin,
    actorIdentityId: null,
  });

  const ph = { timezone: 'Asia/Manila', currency: 'PHP', countryCode: 'PH' };
  const abcProps = await createProperties(prisma, abc.organizationId, [
    { code: 'MNL', name: 'ABC Hotel Manila', city: 'Manila', ...ph },
    { code: 'CEB', name: 'ABC Resort Cebu', city: 'Cebu City', ...ph },
    { code: 'DVO', name: 'ABC Hotel Davao', city: 'Davao City', ...ph },
  ]);
  const xyzProps = await createProperties(prisma, xyz.organizationId, [
    { code: 'BOR', name: 'XYZ Resort Boracay', city: 'Malay', ...ph },
  ]);

  await grant(prisma, abc.organizationId, abc.roleIdsByKey, [
    { identityId: john, role: 'general_manager', propertyIds: [abcProps.MNL!] },
    { identityId: maria, role: 'auditor', propertyIds: [abcProps.MNL!, abcProps.CEB!] },
    { identityId: robert, role: 'auditor', propertyIds: null },
    { identityId: frontDesk, role: 'staff', propertyIds: [abcProps.CEB!] },
    { identityId: reception, role: 'front_desk', propertyIds: [abcProps.MNL!] },
    { identityId: housekeeper, role: 'housekeeper', propertyIds: [abcProps.MNL!] },
    { identityId: consultant, role: 'auditor', propertyIds: null },
  ]);
  await grant(prisma, xyz.organizationId, xyz.roleIdsByKey, [
    { identityId: consultant, role: 'auditor', propertyIds: null },
  ]);

  // ABC offers guest self check-in; XYZ does not (both states are exercised by tests).
  await withDbContext(prisma, { organizationId: abc.organizationId, identityId: null }, (tx) =>
    tx.organizationFeatureFlag.create({
      data: { organizationId: abc.organizationId, flagKey: 'self_checkin', enabled: true },
    }),
  );

  const inventory = {} as DemoWorld['inventory'];
  for (const [code, propertyId] of Object.entries(abcProps)) {
    inventory[code as 'MNL'] = await seedDemoInventory(
      prisma,
      abc.organizationId,
      propertyId,
      DEMO_INVENTORY[code]!,
    );
  }
  inventory.BOR = await seedDemoInventory(
    prisma,
    xyz.organizationId,
    xyzProps.BOR!,
    DEMO_INVENTORY.BOR!,
  );

  return {
    inventory,
    abc: {
      organizationId: abc.organizationId,
      properties: abcProps as DemoWorld['abc']['properties'],
    },
    xyz: {
      organizationId: xyz.organizationId,
      properties: xyzProps as DemoWorld['xyz']['properties'],
    },
    identities,
  };
}

async function createProperties(
  prisma: PrismaClient,
  organizationId: string,
  specs: DemoPropertySpec[],
): Promise<Record<string, string>> {
  return withDbContext(prisma, { organizationId, identityId: null }, async (tx) => {
    const ids: Record<string, string> = {};
    for (const spec of specs) {
      const property = await tx.property.create({
        data: {
          organizationId,
          code: spec.code,
          name: spec.name,
          status: 'ACTIVE',
          timezone: spec.timezone,
          currency: spec.currency,
          locale: 'en-PH',
          countryCode: spec.countryCode,
          city: spec.city,
          checkInTime: '14:00',
          checkOutTime: '12:00',
          currentBusinessDate: new Date('2026-10-01T00:00:00Z'),
        },
      });
      ids[spec.code] = property.id;
    }
    return ids;
  });
}

async function grant(
  prisma: PrismaClient,
  organizationId: string,
  roleIdsByKey: Map<string, string>,
  grants: { identityId: string; role: string; propertyIds: string[] | null }[],
): Promise<void> {
  await withDbContext(prisma, { organizationId, identityId: null }, async (tx) => {
    for (const g of grants) {
      const membership = await tx.organizationMembership.create({
        data: { organizationId, identityId: g.identityId, status: 'ACTIVE', joinedAt: new Date() },
      });
      const roleId = roleIdsByKey.get(g.role)!;
      const scopes = g.propertyIds ?? [null];
      for (const propertyId of scopes) {
        await tx.roleAssignment.create({
          data: {
            organizationId,
            membershipId: membership.id,
            roleId,
            scopeType: propertyId ? 'PROPERTY' : 'ORGANIZATION',
            propertyId,
          },
        });
      }
    }
  });
}
