/**
 * The audit log (ADR-0005): who may read it (audit.read is sensitive, so it needs a
 * verified second factor), what property-scoped readers see, the filters, the id cursor,
 * and that a representative write lands in it with actor and request id.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let john: TestClient;
let robert: TestClient;
let xyzAdmin: TestClient;

interface Entry {
  id: string;
  organizationId: string;
  propertyId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  occurredAt: string;
}

const MNL = () => ctx.world.abc.properties.MNL;
const CEB = () => ctx.world.abc.properties.CEB;
const LOGS = '/api/v1/audit-logs';

/** Renames a property with its current ETag: a representative audited write. */
async function rename(client: TestClient, propertyId: string, name: string, requestId?: string) {
  const current = await client.get(`/api/v1/properties/${propertyId}`);
  const res = await client.request(
    'PATCH',
    `/api/v1/properties/${propertyId}`,
    { name },
    {
      'if-match': String(current.headers.etag),
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}

/** Every page of a query, following the cursor. */
async function allPages(client: TestClient, query: string, limit: number): Promise<Entry[]> {
  const items: Entry[] = [];
  let cursor: string | null = null;
  do {
    const res: { status: number; body: { items: Entry[]; nextCursor: string | null } } =
      await client.get(
        `${LOGS}?${query}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(limit);
    items.push(...res.body.items);
    cursor = res.body.nextCursor;
  } while (cursor);
  return items;
}

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  john = await TestClient.withMfa(ctx.app, 'john.gm@abc.test');
  xyzAdmin = await TestClient.withMfa(ctx.app, 'admin@xyz.test');
  robert = await TestClient.as(ctx.app, 'robert.finance@abc.test');

  // Entries at two properties, by two actors.
  await rename(admin, MNL(), 'ABC Hotel Manila Bay');
  await rename(admin, CEB(), 'ABC Resort Mactan');
  await rename(john, MNL(), 'ABC Hotel Manila');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('access', () => {
  it('needs a session and audit.read', async () => {
    expect((await new TestClient(ctx.app).get(LOGS)).status).toBe(401);
    const reception = await TestClient.as(ctx.app, 'reception@abc.test');
    const res = await reception.get(LOGS);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('needs a verified second factor, even for the auditor', async () => {
    const res = await robert.get(LOGS);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
    const verified = await TestClient.withMfa(ctx.app, 'robert.finance@abc.test');
    expect((await verified.get(LOGS)).status).toBe(200);
  });

  it('shows each organization only its own entries', async () => {
    const abc = await allPages(admin, 'entityType=property', 100);
    expect(abc.length).toBeGreaterThanOrEqual(3);
    expect(new Set(abc.map((e) => e.organizationId))).toEqual(
      new Set([ctx.world.abc.organizationId]),
    );
    const xyz = await allPages(xyzAdmin, 'entityType=property', 100);
    expect(xyz.every((e) => e.organizationId === ctx.world.xyz.organizationId)).toBe(true);
    expect(xyz.map((e) => e.entityId)).not.toContain(MNL());
    // Asking for another tenant's property explicitly yields nothing, not an error.
    expect((await xyzAdmin.get(`${LOGS}?propertyId=${MNL()}`)).body.items).toEqual([]);
  });

  it('limits property-scoped readers to their properties, hiding organization-level entries', async () => {
    const seen = await allPages(john, 'x=1', 100);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((e) => e.propertyId))).toEqual(new Set([MNL()]));

    // The organization-wide reader also sees organization-level entries (e.g. logins, MFA).
    const all = await allPages(admin, 'x=1', 100);
    expect(all.some((e) => e.propertyId === null)).toBe(true);
    expect(all.some((e) => e.propertyId === CEB())).toBe(true);

    // Filtering on a property outside the scope is empty, not a leak.
    expect((await john.get(`${LOGS}?propertyId=${CEB()}`)).body.items).toEqual([]);
  });
});

describe('filters and cursor', () => {
  it('filters by property, entity type and entity id', async () => {
    const byProperty = await allPages(admin, `propertyId=${CEB()}`, 100);
    expect(byProperty.length).toBeGreaterThan(0);
    expect(byProperty.every((e) => e.propertyId === CEB())).toBe(true);

    const byEntity = await admin.get(`${LOGS}?entityType=property&entityId=${MNL()}`);
    expect(byEntity.body.items.map((e: Entry) => [e.action, e.actorId])).toEqual([
      ['property.updated', ctx.world.identities['john.gm@abc.test']],
      ['property.updated', ctx.world.identities['admin@abc.test']],
    ]);

    const none = await admin.get(`${LOGS}?entityType=property&entityId=${randomUUID()}`);
    expect(none.body).toEqual({ items: [], nextCursor: null });
  });

  it('pages newest first without gaps or overlaps', async () => {
    const whole = (await admin.get(`${LOGS}?limit=100`)).body.items as Entry[];
    expect(whole.length).toBeGreaterThan(3);
    const ids = whole.map((e) => e.id);
    expect([...ids].sort().reverse()).toEqual(ids);
    const times = whole.map((e) => Date.parse(e.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const paged = await allPages(admin, 'x=1', 2);
    expect(paged.map((e) => e.id).slice(0, ids.length)).toEqual(ids);
    expect(new Set(paged.map((e) => e.id)).size).toBe(paged.length);

    const first = await admin.get(`${LOGS}?limit=1`);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toBe(first.body.items[0].id);
  });

  it('validates the query', async () => {
    for (const query of [
      'limit=0',
      'limit=101',
      'propertyId=MNL',
      `entityType=${'x'.repeat(65)}`,
    ]) {
      const res = await admin.get(`${LOGS}?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('recording', () => {
  it('records a write with its actor, property, diff and request id', async () => {
    await rename(admin, CEB(), 'ABC Resort Cebu', 'trace-audit-log-1');
    const res = await admin.get(`${LOGS}?entityType=property&entityId=${CEB()}&limit=1`);
    expect(res.body.items[0]).toMatchObject({
      organizationId: ctx.world.abc.organizationId,
      propertyId: CEB(),
      actorType: 'MEMBER',
      actorId: ctx.world.identities['admin@abc.test'],
      action: 'property.updated',
      entityType: 'property',
      entityId: CEB(),
      before: { name: 'ABC Resort Mactan' },
      after: { name: 'ABC Resort Cebu' },
      requestId: 'trace-audit-log-1',
    });
  });

  it('does not record a write that was refused', async () => {
    const before = (await admin.get(`${LOGS}?entityType=property&entityId=${CEB()}`)).body.items
      .length;
    const stale = await admin.request(
      'PATCH',
      `/api/v1/properties/${CEB()}`,
      { name: 'Never applied' },
      { 'if-match': 'W/"1"' },
    );
    expect(stale.status).toBe(412);
    const after = (await admin.get(`${LOGS}?entityType=property&entityId=${CEB()}`)).body.items;
    expect(after).toHaveLength(before);
  });
});
