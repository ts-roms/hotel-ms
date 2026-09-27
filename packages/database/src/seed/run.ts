import { syncPlatformCatalog } from '../catalog.js';
import { createPrismaClient } from '../client.js';
import { seedDemoWorld } from '../demo-world.js';

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
const app = createPrismaClient({
  connectionString: requireEnv('DATABASE_URL'),
  applicationName: 'seed-app',
  maxConnections: 2,
});

try {
  await syncPlatformCatalog(owner);
  console.log('Platform catalog synchronized.');

  const seedDemo = process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO !== 'false';
  if (seedDemo) {
    const existing = await app.identity.findUnique({ where: { email: 'admin@abc.test' } });
    if (existing) {
      console.log('Demo data already present; skipping.');
    } else {
      const world = await seedDemoWorld(app);
      console.log(
        `Demo data created: ${Object.keys(world.identities).length} identities, 2 organizations, 4 properties.`,
      );
      console.log('Demo password: see DEMO_PASSWORD in packages/database/src/demo-world.ts');
    }
  }
} finally {
  await owner.$disconnect();
  await app.$disconnect();
}
