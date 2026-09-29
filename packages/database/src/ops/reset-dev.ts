/**
 * Development reset: wipes the local database, re-applies every migration and seeds the
 * demo world. `pnpm db:reset` runs this.
 *
 * Not `prisma migrate reset`: that drops only the `public` schema, while the first
 * migration also creates the `app` schema (RLS context functions, ADR-0003), so every
 * reset after the first failed on "function current_org_id already exists" and left the
 * database half-migrated.
 *
 * Both schemas are dropped in one transaction, so a failure never leaves tables without
 * their RLS policies. Refuses any database that is not on this machine.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createPrismaClient } from '../client.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const connectionString = process.env.DATABASE_OWNER_URL?.trim();
if (!connectionString) throw new Error('DATABASE_OWNER_URL is not set');
const url = new URL(connectionString);
const database = url.pathname.slice(1);
if (!LOCAL_HOSTS.has(url.hostname)) {
  throw new Error(`Refusing to reset "${database}" on ${url.hostname}: only local databases`);
}
if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to reset with NODE_ENV=production');
}

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '../..');
const run = (args: string[]) =>
  execFileSync(process.execPath, args, { cwd: PACKAGE_ROOT, stdio: 'inherit' });

const owner = createPrismaClient({
  connectionString,
  applicationName: 'ops-reset-dev',
  maxConnections: 1,
});
try {
  await owner.$transaction([
    owner.$executeRawUnsafe('DROP SCHEMA IF EXISTS app CASCADE'),
    owner.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE'),
    owner.$executeRawUnsafe('CREATE SCHEMA public'),
  ]);
  console.log(`Dropped schemas app and public in "${database}" on ${url.host}.`);
} finally {
  await owner.$disconnect();
}

run([path.join(PACKAGE_ROOT, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy']);
run([path.join(PACKAGE_ROOT, 'dist', 'seed', 'run.js')]);
