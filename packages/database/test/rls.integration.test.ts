/**
 * Database-level tenant isolation tests (spec §61, blueprint §23.2).
 * These run against a real PostgreSQL with the real roles; nothing is mocked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, withDbContext, type PrismaClient } from '../src/index.js';
import { prepareTestDatabase, testDatabaseUrls } from '../src/testing.js';
import type { DemoWorld } from '../src/demo-world.js';

let world: DemoWorld;
let owner: PrismaClient;
let app: PrismaClient;
let system: PrismaClient;

beforeAll(async () => {
  world = await prepareTestDatabase();
  const urls = testDatabaseUrls();
  owner = createPrismaClient({ connectionString: urls.owner, maxConnections: 1 });
  // One connection so tests prove context does not leak across pooled transactions.
  app = createPrismaClient({ connectionString: urls.app, maxConnections: 1 });
  system = createPrismaClient({ connectionString: urls.system, maxConnections: 1 });
}, 120_000);

afterAll(async () => {
  await Promise.all([owner?.$disconnect(), app?.$disconnect(), system?.$disconnect()]);
});

const ctxA = () => ({ organizationId: world.abc.organizationId, identityId: null });
const ctxB = () => ({ organizationId: world.xyz.organizationId, identityId: null });

describe('RLS coverage', () => {
  it('every table with organization_id has RLS enabled, forced, and a tenant_isolation policy', async () => {
    const rows = await owner.$queryRaw<
      { table_name: string; rls: boolean; forced: boolean; has_policy: boolean }[]
    >`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS forced,
             EXISTS (SELECT 1 FROM pg_policies p
                     WHERE p.schemaname = 'public' AND p.tablename = c.relname
                       AND p.policyname = 'tenant_isolation') AS has_policy
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND (c.relname = 'organizations' OR EXISTS (
              SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema = 'public' AND col.table_name = c.relname
                AND col.column_name = 'organization_id'))`;

    expect(rows.length).toBeGreaterThan(10);
    const unprotected = rows.filter((r) => !r.rls || !r.forced || !r.has_policy);
    expect(unprotected.map((r) => r.table_name)).toEqual([]);
  });

  it('the runtime role cannot bypass RLS', async () => {
    const [row] = await app.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(row).toEqual({ rolbypassrls: false, rolsuper: false });
  });
});

describe('tenant context', () => {
  it('sees only the current organization rows', async () => {
    const aProps = await withDbContext(app, ctxA(), (tx) => tx.property.findMany());
    const bProps = await withDbContext(app, ctxB(), (tx) => tx.property.findMany());

    expect(aProps.map((p) => p.code).sort()).toEqual(['CEB', 'DVO', 'MNL']);
    expect(bProps.map((p) => p.code)).toEqual(['BOR']);
    expect(aProps.every((p) => p.organizationId === world.abc.organizationId)).toBe(true);
  });

  it('fails closed without a context', async () => {
    const count = await withDbContext(app, { organizationId: null, identityId: null }, (tx) =>
      tx.property.count(),
    );
    expect(count).toBe(0);
    expect(await app.property.count()).toBe(0);
    expect(await app.role.count()).toBe(0);
    expect(await app.auditLog.count()).toBe(0);
  });

  it('does not leak the context to the next use of a pooled connection', async () => {
    await withDbContext(app, ctxA(), (tx) => tx.property.count());
    // Same single connection, no context set: must see nothing.
    expect(await app.property.count()).toBe(0);
    const [setting] = await app.$queryRaw<
      { org: string | null }[]
    >`SELECT app.current_org_id()::text AS org`;
    expect(setting?.org).toBeNull();
  });

  it('cannot fetch another tenant row by primary key', async () => {
    const found = await withDbContext(app, ctxB(), (tx) =>
      tx.property.findUnique({ where: { id: world.abc.properties.MNL } }),
    );
    expect(found).toBeNull();
  });

  it('cannot update or delete another tenant rows', async () => {
    const updated = await withDbContext(app, ctxB(), (tx) =>
      tx.property.updateMany({ where: { id: world.abc.properties.MNL }, data: { name: 'pwned' } }),
    );
    expect(updated.count).toBe(0);
    const deleted = await withDbContext(app, ctxB(), (tx) =>
      tx.role.deleteMany({ where: { organizationId: world.abc.organizationId } }),
    );
    expect(deleted.count).toBe(0);
  });

  it('rejects inserting a row for another organization', async () => {
    await expect(
      withDbContext(app, ctxA(), (tx) =>
        tx.brand.create({
          data: { organizationId: world.xyz.organizationId, code: 'EVIL', name: 'Evil' },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('rejects moving a row to another organization', async () => {
    await expect(
      withDbContext(app, ctxA(), (tx) =>
        tx.property.update({
          where: { id: world.abc.properties.DVO },
          data: { organizationId: world.xyz.organizationId },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('composite foreign keys', () => {
  it('prevent referencing another tenant property even with a matching organization_id', async () => {
    const { organizationId } = ctxA();
    await expect(
      withDbContext(app, ctxA(), async (tx) => {
        const membership = await tx.organizationMembership.findFirstOrThrow();
        const role = await tx.role.findFirstOrThrow({ where: { key: 'staff' } });
        return tx.roleAssignment.create({
          data: {
            organizationId,
            membershipId: membership.id,
            roleId: role.id,
            scopeType: 'PROPERTY',
            propertyId: world.xyz.properties.BOR,
          },
        });
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('enforce scope_type / property_id consistency', async () => {
    await expect(
      withDbContext(app, ctxA(), async (tx) => {
        const membership = await tx.organizationMembership.findFirstOrThrow();
        const role = await tx.role.findFirstOrThrow({ where: { key: 'staff' } });
        return tx.roleAssignment.create({
          data: {
            organizationId: world.abc.organizationId,
            membershipId: membership.id,
            roleId: role.id,
            scopeType: 'ORGANIZATION',
            propertyId: world.abc.properties.MNL,
          },
        });
      }),
    ).rejects.toThrow(/role_assignments_scope_matches_target/);
  });
});

describe('identity context (before an organization is selected)', () => {
  it('lists only the identity own memberships and their organizations', async () => {
    const consultant = world.identities['consultant@shared.test']!;
    const result = await withDbContext(
      app,
      { organizationId: null, identityId: consultant },
      async (tx) => ({
        memberships: await tx.organizationMembership.findMany(),
        organizations: await tx.organization.findMany({ orderBy: { name: 'asc' } }),
        properties: await tx.property.findMany(),
      }),
    );

    expect(result.memberships).toHaveLength(2);
    expect(result.memberships.every((m) => m.identityId === consultant)).toBe(true);
    expect(result.organizations.map((o) => o.name)).toEqual([
      'ABC Hospitality Group',
      'XYZ Resorts',
    ]);
    expect(result.properties).toHaveLength(0);
  });

  it('cannot modify organizations through the identity policy', async () => {
    const consultant = world.identities['consultant@shared.test']!;
    const updated = await withDbContext(
      app,
      { organizationId: null, identityId: consultant },
      (tx) => tx.organization.updateMany({ data: { name: 'pwned' } }),
    );
    expect(updated.count).toBe(0);
  });
});

describe('append-only audit log', () => {
  it('runtime role cannot update or delete audit rows', async () => {
    await expect(
      withDbContext(app, ctxA(), (tx) => tx.auditLog.updateMany({ data: { action: 'tampered' } })),
    ).rejects.toThrow(/permission denied/i);
    await expect(withDbContext(app, ctxA(), (tx) => tx.auditLog.deleteMany())).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('even the owner cannot update audit rows through DML', async () => {
    // The owner is itself subject to FORCE RLS (sees no rows), so lift that inside a
    // transaction to reach the trigger. The failure rolls the DDL back as well.
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`ALTER TABLE audit_logs NO FORCE ROW LEVEL SECURITY`;
        await tx.$executeRaw`UPDATE audit_logs SET action = 'tampered'`;
      }),
    ).rejects.toThrow(/append-only/);
    const [row] = await owner.$queryRaw<{ forced: boolean }[]>`
      SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname = 'audit_logs'`;
    expect(row?.forced).toBe(true);
  });
});

describe('system role', () => {
  it('can read outbox events across tenants but no business tables', async () => {
    for (const ctx of [ctxA(), ctxB()]) {
      await withDbContext(app, ctx, (tx) =>
        tx.outboxEvent.create({
          data: {
            id: crypto.randomUUID(),
            organizationId: ctx.organizationId,
            type: 'Test',
            payload: {},
            actorType: 'SYSTEM',
          },
        }),
      );
    }
    const events = await system.outboxEvent.findMany({ where: { type: 'Test' } });
    expect(new Set(events.map((e) => e.organizationId))).toEqual(
      new Set([world.abc.organizationId, world.xyz.organizationId]),
    );
    await expect(system.property.findMany()).rejects.toThrow(/permission denied/i);
  });
});
