/**
 * Test harness helpers. Imported via `@hotel/database/testing`; never from production code.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { syncPlatformCatalog } from './catalog.js';
import { createPrismaClient } from './client.js';
import { seedDemoWorld, type DemoWorld } from './demo-world.js';

export interface TestDatabaseUrls {
  owner: string;
  app: string;
  system: string;
}

/** Test URLs: TEST_DATABASE_*_URL if set, otherwise the dev URLs pointed at `hotel_test`. */
export function testDatabaseUrls(): TestDatabaseUrls {
  const toTest = (url: string | undefined, name: string) => {
    if (!url) throw new Error(`${name} is not set`);
    const u = new URL(url);
    u.pathname = '/hotel_test';
    return u.toString();
  };
  return {
    owner:
      process.env.TEST_DATABASE_OWNER_URL ??
      toTest(process.env.DATABASE_OWNER_URL, 'DATABASE_OWNER_URL'),
    app: process.env.TEST_DATABASE_URL ?? toTest(process.env.DATABASE_URL, 'DATABASE_URL'),
    system:
      process.env.TEST_DATABASE_SYSTEM_URL ??
      toTest(process.env.DATABASE_SYSTEM_URL, 'DATABASE_SYSTEM_URL'),
  };
}

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Applies migrations (non-destructive `migrate deploy`), truncates every table except the
 * migration history, re-syncs the platform catalog and seeds the two-organization demo
 * world. Refuses to touch a database whose name does not end in `_test`.
 */
export async function prepareTestDatabase(): Promise<DemoWorld> {
  const urls = testDatabaseUrls();
  const dbName = new URL(urls.owner).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset non-test database "${dbName}"`);
  }

  execFileSync(
    process.execPath,
    [path.join(PACKAGE_ROOT, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'],
    {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, DATABASE_OWNER_URL: urls.owner },
      stdio: 'pipe',
    },
  );

  const owner = createPrismaClient({
    connectionString: urls.owner,
    applicationName: 'test-owner',
    maxConnections: 1,
  });
  const app = createPrismaClient({
    connectionString: urls.app,
    applicationName: 'test-seed',
    maxConnections: 2,
  });
  try {
    const tables = await owner.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length > 0) {
      const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
      await owner.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
    }
    await syncPlatformCatalog(owner);
    return await seedDemoWorld(app);
  } finally {
    await owner.$disconnect();
    await app.$disconnect();
  }
}
