import {
  addMissingTemplateRoles,
  propagateTemplatePermissions,
  syncPlatformCatalog,
} from '../catalog.js';
import { createPrismaClient } from '../client.js';
import { withDbContext } from '../context.js';
import { seedDemoFnb } from './demo-fnb.js';
import { DEMO_EMPLOYEES, seedDemoHr } from './demo-hr.js';
import { DEMO_INVENTORY, seedDemoInventory } from './demo-pms.js';
import { seedDemoWorld } from './demo-world.js';

/** Adds demo inventory and HR data to demo databases created before they existed. */
async function ensureDemoInventory(): Promise<void> {
  for (const email of ['admin@abc.test', 'admin@xyz.test']) {
    const admin = await app.identity.findUnique({ where: { email } });
    if (!admin) continue;
    const memberships = await withDbContext(
      app,
      { organizationId: null, identityId: admin.id },
      (tx) => tx.organizationMembership.findMany({ select: { organizationId: true } }),
    );
    for (const { organizationId } of memberships) {
      const properties = await withDbContext(app, { organizationId, identityId: null }, (tx) =>
        tx.property.findMany({ select: { id: true, code: true } }),
      );
      for (const property of properties) {
        const spec = DEMO_INVENTORY[property.code];
        if (spec) await seedDemoInventory(app, organizationId, property.id, spec);
      }
      const employees = DEMO_EMPLOYEES[email === 'admin@abc.test' ? 'abc' : 'xyz'];
      const byCode = Object.fromEntries(properties.map((p) => [p.code, p.id]));
      await seedDemoHr(app, organizationId, byCode, employees);
      for (const code of ['MNL', 'BOR']) {
        if (byCode[code]) await seedDemoFnb(app, organizationId, byCode[code]);
      }
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const owner = createPrismaClient({
  connectionString: requireEnv('DATABASE_OWNER_URL'),
  applicationName: 'seed-owner',
  maxConnections: 1,
});
const system = createPrismaClient({
  connectionString: requireEnv('DATABASE_SYSTEM_URL'),
  applicationName: 'seed-system',
  maxConnections: 1,
});
const app = createPrismaClient({
  connectionString: requireEnv('DATABASE_URL'),
  applicationName: 'seed-app',
  maxConnections: 2,
});

try {
  await syncPlatformCatalog(owner);
  console.log('Platform catalog synchronized.');
  const changed = await propagateTemplatePermissions(system);
  console.log(`Template permissions propagated to ${changed} organization role(s).`);
  const added = await addMissingTemplateRoles(system, app);
  console.log(`Missing template roles added: ${added}.`);

  const seedDemo = process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO !== 'false';
  if (seedDemo) {
    const existing = await app.identity.findUnique({ where: { email: 'admin@abc.test' } });
    if (existing) {
      await ensureDemoInventory();
      console.log('Demo data already present; ensured demo inventory, HR and F&B data.');
    } else {
      const world = await seedDemoWorld(app);
      console.log(
        `Demo data created: ${Object.keys(world.identities).length} identities, 2 organizations, 4 properties.`,
      );
      console.log('Demo password: see DEMO_PASSWORD in packages/database/src/seed/demo-world.ts');
    }
  }
} finally {
  await owner.$disconnect();
  await system.$disconnect();
  await app.$disconnect();
}
