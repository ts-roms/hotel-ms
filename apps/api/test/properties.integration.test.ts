/**
 * Tenancy: properties (blueprint §5). Listing within the caller's scope with a code
 * cursor, reading with an ETag, creating (organization-level permission), and editing
 * with optimistic concurrency via If-Match (ADR-0009). Every change is audited and
 * announced through the outbox (ADR-0005).
 */
import { createPrismaClient, type PrismaClient } from '@hotel/database';
import { testDatabaseUrls } from '@hotel/database/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let john: TestClient;
let reception: TestClient;
let xyzAdmin: TestClient;
let system: PrismaClient;

const MNL = () => ctx.world.abc.properties.MNL;
const CEB = () => ctx.world.abc.properties.CEB;
const url = (id: string) => `/api/v1/properties/${id}`;
const codes = (body: { items: { code: string }[] }) => body.items.map((p) => p.code);

const newProperty = {
  code: 'BAG',
  name: 'ABC Hotel Baguio',
  timezone: 'Asia/Manila',
  currency: 'PHP',
  locale: 'en-PH',
  countryCode: 'PH',
  city: 'Baguio',
  currentBusinessDate: '2026-11-01',
};
let bagId: string;

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  john = await TestClient.as(ctx.app, 'john.gm@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  xyzAdmin = await TestClient.withMfa(ctx.app, 'admin@xyz.test');
  system = createPrismaClient({ connectionString: testDatabaseUrls().system, maxConnections: 1 });
});
afterAll(async () => {
  await system?.$disconnect();
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

/** Outbox events for a property (the relay's role sees every tenant's outbox). */
const eventsFor = (propertyId: string) =>
  system.outboxEvent.findMany({ where: { propertyId }, orderBy: { occurredAt: 'asc' } });

describe('listing', () => {
  it('lists the organization’s properties by code for organization-wide roles', async () => {
    const res = await admin.get('/api/v1/properties');
    expect(res.status).toBe(200);
    expect(codes(res.body)).toEqual(['CEB', 'DVO', 'MNL']);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items.find((p: { code: string }) => p.code === 'MNL')).toMatchObject({
      id: MNL(),
      organizationId: ctx.world.abc.organizationId,
      name: 'ABC Hotel Manila',
      timezone: 'Asia/Manila',
      currency: 'PHP',
      version: expect.any(Number),
    });

    expect(codes((await xyzAdmin.get('/api/v1/properties')).body)).toEqual(['BOR']);
  });

  it('limits property-scoped roles to their properties', async () => {
    expect(codes((await john.get('/api/v1/properties')).body)).toEqual(['MNL']);
    expect(codes((await reception.get('/api/v1/properties')).body)).toEqual(['MNL']);
  });

  it('pages with a cursor', async () => {
    const first = await admin.get('/api/v1/properties?limit=2');
    expect(codes(first.body)).toEqual(['CEB', 'DVO']);
    expect(first.body.nextCursor).toBe('DVO');
    const second = await admin.get(`/api/v1/properties?limit=2&cursor=${first.body.nextCursor}`);
    expect(codes(second.body)).toEqual(['MNL']);
    expect(second.body.nextCursor).toBeNull();

    expect((await admin.get('/api/v1/properties?limit=0')).status).toBe(400);
    expect((await admin.get('/api/v1/properties?limit=101')).status).toBe(400);
  });

  it('needs a session', async () => {
    const anonymous = new TestClient(ctx.app);
    expect((await anonymous.get('/api/v1/properties')).status).toBe(401);
  });
});

describe('reading', () => {
  it('returns the property with a weak ETag of its version', async () => {
    const res = await john.get(url(MNL()));
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('MNL');
    expect(res.headers.etag).toBe(`W/"${res.body.version}"`);
  });

  it('answers 404 outside the caller’s scope or tenant, and for unknown ids', async () => {
    expect((await john.get(url(CEB()))).status).toBe(404);
    expect((await xyzAdmin.get(url(MNL()))).status).toBe(404);
    expect((await admin.get(url(ctx.world.xyz.properties.BOR))).status).toBe(404);
    expect((await admin.get(url(randomUUID()))).status).toBe(404);
  });
});

describe('creating', () => {
  it('is an organization-level permission', async () => {
    // The GM manages MNL but cannot open new properties.
    const res = await john.request('POST', '/api/v1/properties', newProperty);
    expect(res.status).toBe(403);
    expect((await reception.request('POST', '/api/v1/properties', newProperty)).status).toBe(403);
  });

  it('validates the request', async () => {
    for (const body of [
      { ...newProperty, code: 'bag' },
      { ...newProperty, timezone: 'Mars/Olympus' },
      { ...newProperty, name: 'X' },
      { ...newProperty, organizationId: ctx.world.xyz.organizationId },
      { ...newProperty, currentBusinessDate: '2026-13-01' },
    ]) {
      const res = await admin.request('POST', '/api/v1/properties', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    const brand = await admin.request('POST', '/api/v1/properties', {
      ...newProperty,
      brandId: randomUUID(),
    });
    expect(brand.status).toBe(400);
    expect(brand.body.errors).toEqual([expect.objectContaining({ path: 'brandId' })]);
  });

  it('creates a property with defaults, audited and announced', async () => {
    const res = await admin.request('POST', '/api/v1/properties', newProperty);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      code: 'BAG',
      name: 'ABC Hotel Baguio',
      organizationId: ctx.world.abc.organizationId,
      status: expect.any(String),
      city: 'Baguio',
      addressLine1: null,
      checkInTime: '14:00',
      checkOutTime: '12:00',
      currentBusinessDate: '2026-11-01',
      version: 1,
    });
    expect(res.headers.etag).toBe('W/"1"');
    bagId = res.body.id;

    expect(codes((await admin.get('/api/v1/properties')).body)).toEqual([
      'BAG',
      'CEB',
      'DVO',
      'MNL',
    ]);
    // Nobody scoped to other properties sees it.
    expect(codes((await john.get('/api/v1/properties')).body)).toEqual(['MNL']);

    const audit = await admin.get(`/api/v1/audit-logs?entityType=property&entityId=${bagId}`);
    expect(audit.body.items).toEqual([
      expect.objectContaining({
        action: 'property.created',
        propertyId: bagId,
        actorId: ctx.world.identities['admin@abc.test'],
        after: expect.objectContaining({ code: 'BAG', name: 'ABC Hotel Baguio' }),
      }),
    ]);

    const events = await eventsFor(bagId);
    expect(events.map((e) => [e.type, e.payload])).toEqual([
      ['PropertyCreated', { propertyId: bagId, code: 'BAG', name: 'ABC Hotel Baguio' }],
    ]);
    expect(events[0]!.organizationId).toBe(ctx.world.abc.organizationId);
  });

  it('refuses a code already used in the organization, but not in another one', async () => {
    const dup = await admin.request('POST', '/api/v1/properties', { ...newProperty, name: 'Dup' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CONFLICT');

    const elsewhere = await xyzAdmin.request('POST', '/api/v1/properties', newProperty);
    expect(elsewhere.status).toBe(201);
    expect(elsewhere.body.organizationId).toBe(ctx.world.xyz.organizationId);
  });
});

describe('editing', () => {
  it('requires If-Match', async () => {
    const res = await admin.request('PATCH', url(bagId), { name: 'No precondition' });
    expect(res.status).toBe(428);
    expect(res.body.code).toBe('PRECONDITION_REQUIRED');
  });

  it('refuses stale or malformed versions without changing anything', async () => {
    for (const ifMatch of ['W/"99"', '"0"', 'garbage']) {
      const res = await admin.request(
        'PATCH',
        url(bagId),
        { name: 'Stale' },
        { 'if-match': ifMatch },
      );
      expect(res.status, ifMatch).toBe(412);
      expect(res.body.code).toBe('VERSION_CONFLICT');
    }
    expect((await admin.get(url(bagId))).body).toMatchObject({
      name: 'ABC Hotel Baguio',
      version: 1,
    });
  });

  it('updates with the current ETag, bumps the version, and audits only what changed', async () => {
    const current = await admin.get(url(bagId));
    const res = await admin.request(
      'PATCH',
      url(bagId),
      { name: 'ABC Hotel Baguio City', phone: '+63 74 000 0000' },
      { 'if-match': String(current.headers.etag), 'x-request-id': 'trace-property-edit-1' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      name: 'ABC Hotel Baguio City',
      phone: '+63 74 000 0000',
      city: 'Baguio',
      checkInTime: '14:00',
      version: 2,
    });
    expect(res.headers.etag).toBe('W/"2"');

    // The old ETag is now stale.
    const replay = await admin.request(
      'PATCH',
      url(bagId),
      { name: 'Lost update' },
      { 'if-match': String(current.headers.etag) },
    );
    expect(replay.status).toBe(412);

    const audit = await admin.get(`/api/v1/audit-logs?entityType=property&entityId=${bagId}`);
    expect(audit.body.items[0]).toMatchObject({
      action: 'property.updated',
      before: { name: 'ABC Hotel Baguio', phone: null },
      after: { name: 'ABC Hotel Baguio City', phone: '+63 74 000 0000' },
      requestId: 'trace-property-edit-1',
    });
    const events = await eventsFor(bagId);
    expect(events.at(-1)).toMatchObject({
      type: 'PropertyUpdated',
      payload: { propertyId: bagId, changedFields: ['name', 'phone'] },
      correlationId: 'trace-property-edit-1',
    });
  });

  it('records no audit entry or event for an update that changes nothing', async () => {
    const before = await admin.get(`/api/v1/audit-logs?entityType=property&entityId=${bagId}`);
    const eventsBefore = (await eventsFor(bagId)).length;
    const current = await admin.get(url(bagId));
    const res = await admin.request(
      'PATCH',
      url(bagId),
      { name: current.body.name },
      { 'if-match': String(current.headers.etag) },
    );
    expect(res.status).toBe(200);
    const after = await admin.get(`/api/v1/audit-logs?entityType=property&entityId=${bagId}`);
    expect(after.body.items).toHaveLength(before.body.items.length);
    expect(await eventsFor(bagId)).toHaveLength(eventsBefore);
  });

  it('refuses fields that are not editable here', async () => {
    const current = await admin.get(url(bagId));
    for (const body of [{ code: 'BGO' }, { timezone: 'UTC' }, { currency: 'USD' }, { name: '' }]) {
      const res = await admin.request('PATCH', url(bagId), body, {
        'if-match': String(current.headers.etag),
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('lets a property-scoped manager edit their property only', async () => {
    const mnl = await john.get(url(MNL()));
    const res = await john.request(
      'PATCH',
      url(MNL()),
      { checkOutTime: '11:00' },
      { 'if-match': String(mnl.headers.etag) },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.checkOutTime).toBe('11:00');

    const ceb = await admin.get(url(CEB()));
    expect(
      (
        await john.request(
          'PATCH',
          url(CEB()),
          { name: 'Not mine' },
          { 'if-match': String(ceb.headers.etag) },
        )
      ).status,
    ).toBe(404);
    const byReception = await reception.request(
      'PATCH',
      url(MNL()),
      { name: 'Front desk rename' },
      { 'if-match': String(res.headers.etag) },
    );
    expect(byReception.status).toBe(403);
    expect(
      (
        await xyzAdmin.request(
          'PATCH',
          url(MNL()),
          { name: 'Hostile' },
          { 'if-match': String(res.headers.etag) },
        )
      ).status,
    ).toBe(404);
  });
});
