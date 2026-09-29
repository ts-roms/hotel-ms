/**
 * Shared devices (ADR-0020): pairing codes, staff PINs, operator sessions, and grants
 * narrowed to the device's permissions at its own property.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, withDbContext } from '@hotel/database';
import { DEMO_PASSWORD } from '@hotel/database/testing';
import { testDatabaseUrls } from '@hotel/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient, WEB_ORIGIN } from './harness.js';

let ctx: TestContext;
let john: TestClient;
let kitchen: TestClient;
let reception: TestClient;
let xyzAdmin: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const CEB = () => ctx.world.abc.properties.CEB;
const devicesUrl = () => `/api/v1/properties/${MNL()}/devices`;
let deviceIp = 0;

/** A tablet's browser: device and operator cookies, the kiosk CSRF token. */
class Kiosk {
  private readonly cookies = new Map<string, string>();
  csrf: string | undefined;
  private readonly ip = `10.66.0.${++deviceIp}`;

  constructor(private readonly app: NestFastifyApplication) {}

  async request(method: 'GET' | 'POST' | 'PUT', url: string, body?: object, csrf = true) {
    const res = await this.app.inject({
      method,
      url,
      ...(body === undefined ? {} : { payload: body }),
      headers: {
        origin: WEB_ORIGIN,
        'x-forwarded-for': this.ip,
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(csrf && this.csrf && method !== 'GET' ? { 'x-csrf-token': this.csrf } : {}),
      },
    });
    for (const c of res.cookies) {
      if (c.value && (!c.expires || new Date(c.expires) > new Date()))
        this.cookies.set(c.name, c.value);
      else this.cookies.delete(c.name);
    }
    const parsed =
      res.body && String(res.headers['content-type']).includes('json')
        ? JSON.parse(res.body)
        : null;
    if (parsed?.csrfToken) this.csrf = parsed.csrfToken;
    return { status: res.statusCode, body: parsed, cookies: res.cookies };
  }

  get deviceCookie() {
    return this.cookies.get('hotel_device');
  }
}

async function register(permissions: string[], name = 'Kitchen tablet') {
  const res = await john.request('POST', devicesUrl(), { name, permissions });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { device: { id: string }; pairingCode: string };
}

async function pairedKiosk(permissions: string[]) {
  const { device, pairingCode } = await register(permissions);
  const kiosk = new Kiosk(ctx.app);
  const paired = await kiosk.request('POST', '/api/v1/kiosk/pair', { code: pairingCode });
  expect(paired.status, JSON.stringify(paired.body)).toBe(200);
  return { kiosk, deviceId: device.id, state: paired.body };
}

const membershipOf = async (email: string) =>
  (await john.get('/api/v1/members')).body.find((m: { email: string }) => m.email === email)
    .membershipId as string;

beforeAll(async () => {
  ctx = await startTestApp();
  john = await TestClient.withMfa(ctx.app, 'john.gm@abc.test');
  kitchen = await TestClient.as(ctx.app, 'kitchen@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  xyzAdmin = await TestClient.withMfa(ctx.app, 'admin@xyz.test');
  // Kai (kitchen) and John (GM) set their PINs.
  for (const [client, pin] of [
    [kitchen, '2468'],
    [john, '8642'],
  ] as const) {
    const res = await client.request('PUT', '/api/v1/me/pin', {
      pin,
      currentPassword: DEMO_PASSWORD,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('device management', () => {
  it('managers register devices with kitchen permissions only, per property', async () => {
    const body = { name: 'Pass tablet', permissions: ['fnb.order.read'] };
    expect((await reception.request('POST', devicesUrl(), body)).status).toBe(403);
    expect(
      (await john.request('POST', devicesUrl(), { ...body, permissions: ['folio.read'] })).status,
    ).toBe(400);
    const created = await john.request('POST', devicesUrl(), body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.pairingCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(created.body.device).toMatchObject({ name: 'Pass tablet', status: 'PENDING' });
    const list = await john.get(devicesUrl());
    expect(list.body.items.map((d: { id: string }) => d.id)).toContain(created.body.device.id);
    expect(JSON.stringify(list.body)).not.toContain(created.body.pairingCode);
    // Other properties and other tenants see none of it.
    expect((await john.get(`/api/v1/properties/${CEB()}/devices`)).status).toBe(404);
    expect((await xyzAdmin.get(devicesUrl())).status).toBe(404);
  });

  it('a pairing code works once, is not case- or dash-sensitive, and expires', async () => {
    const { pairingCode } = await register(['fnb.order.read']);
    const kiosk = new Kiosk(ctx.app);
    expect((await kiosk.request('POST', '/api/v1/kiosk/pair', { code: 'nope' })).status).toBe(400);
    const unknown = await kiosk.request('POST', '/api/v1/kiosk/pair', { code: 'AAAAAAAA' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('INVALID_TOKEN');
    const typed = `${pairingCode.slice(0, 4)}-${pairingCode.slice(4)}`.toLowerCase();
    const paired = await kiosk.request('POST', '/api/v1/kiosk/pair', { code: typed });
    expect(paired.status, JSON.stringify(paired.body)).toBe(200);
    expect(paired.body.device).toMatchObject({
      name: 'Kitchen tablet',
      propertyName: expect.any(String),
    });
    expect(paired.body.operator).toBeNull();
    expect(kiosk.deviceCookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(paired.cookies.find((c) => c.name === 'hotel_device')).toMatchObject({
      httpOnly: true,
      sameSite: 'Strict',
    });
    const again = new Kiosk(ctx.app);
    expect(
      (await again.request('POST', '/api/v1/kiosk/pair', { code: pairingCode })).body.code,
    ).toBe('INVALID_TOKEN');

    // An expired code is refused.
    const late = await register(['fnb.order.read']);
    const app = createPrismaClient({ connectionString: testDatabaseUrls().app, maxConnections: 1 });
    try {
      await withDbContext(
        app,
        { organizationId: ctx.world.abc.organizationId, identityId: null },
        (tx) =>
          tx.device.update({
            where: { id: late.device.id },
            data: { pairingExpiresAt: new Date(Date.now() - 1000) },
          }),
      );
    } finally {
      await app.$disconnect();
    }
    const expired = await again.request('POST', '/api/v1/kiosk/pair', { code: late.pairingCode });
    expect(expired.body.code).toBe('INVALID_TOKEN');
  });
});

describe('staff PINs', () => {
  it('need the account password, and refuse trivial PINs', async () => {
    const set = (body: object) => kitchen.request('PUT', '/api/v1/me/pin', body);
    expect((await set({ pin: '2468', currentPassword: 'wrong-password' })).status).toBe(400);
    expect((await set({ pin: '1111', currentPassword: DEMO_PASSWORD })).status).toBe(400);
    expect((await set({ pin: '1234', currentPassword: DEMO_PASSWORD })).status).toBe(400);
    expect((await set({ pin: '12a4', currentPassword: DEMO_PASSWORD })).status).toBe(400);
    expect((await kitchen.get('/api/v1/me/pin')).body).toEqual({ hasPin: true });
    expect((await reception.get('/api/v1/me/pin')).body).toEqual({ hasPin: false });
  });
});

describe('operators on a device', () => {
  it('lists who may sign in: a PIN and a device permission at this property', async () => {
    const { state } = await pairedKiosk(['fnb.order.read', 'fnb.order.update']);
    const names = state.operators.map((o: { name: string }) => o.name);
    expect(names).toContain('Kai Kitchen');
    expect(names).toContain('John Reyes');
    // Reception reads orders but has no PIN; housekeeping has neither.
    expect(names).not.toContain('Rey Reception');
    expect(names).not.toContain('Hana Housekeeper');
  });

  it('a PIN signs the operator in; grants are the device permissions they hold, here only', async () => {
    const { kiosk } = await pairedKiosk(['fnb.order.read', 'fnb.order.update']);
    const kai = await membershipOf('kitchen@abc.test');
    const orders = `/api/v1/properties/${MNL()}/orders`;
    // No operator yet: the device alone reaches nothing.
    expect((await kiosk.request('GET', orders)).status).toBe(401);

    const signIn = (membershipId: string, pin: string, csrf = true) =>
      kiosk.request('POST', '/api/v1/kiosk/sign-in', { membershipId, pin }, csrf);
    expect((await signIn(kai, '2468', false)).status).toBe(403);
    expect((await signIn(kai, '0000')).status).toBe(401);
    const ok = await signIn(kai, '2468');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.operator).toMatchObject({ membershipId: kai, name: 'Kai Kitchen' });

    expect((await kiosk.request('GET', orders)).status).toBe(200);
    // Its own property only; no organization-wide or account routes.
    expect((await kiosk.request('GET', `/api/v1/properties/${CEB()}/orders`)).status).toBe(404);
    expect((await kiosk.request('GET', '/api/v1/employees')).status).toBe(404);
    expect((await kiosk.request('GET', '/api/v1/auth/session')).status).toBe(401);
    expect((await kiosk.request('GET', '/api/v1/me/pin')).status).toBe(404);
    // Writes need the kiosk CSRF token.
    const item = Object.values(ctx.world.fnb.MNL.items)[0]!;
    const availability = `/api/v1/properties/${MNL()}/menu-items/${item}/availability`;
    // Kai holds fnb.menu.availability, but this device does not.
    expect((await kiosk.request('PUT', availability, { available: false })).status).toBe(403);

    // John holds fnb.menu.manage; the device still does not.
    const johnId = await membershipOf('john.gm@abc.test');
    expect((await signIn(johnId, '8642')).status).toBe(200);
    const outlet = await kiosk.request('POST', `/api/v1/properties/${MNL()}/outlets`, {
      code: 'BAR',
      name: 'Bar',
    });
    expect(outlet.status).toBe(403);
    // Signing in replaced Kai's session on this device.
    const state = await kiosk.request('GET', '/api/v1/kiosk');
    expect(state.body.operator.name).toBe('John Reyes');

    const out = await kiosk.request('POST', '/api/v1/kiosk/sign-out', {});
    expect(out.status).toBe(200);
    expect(out.body.operator).toBeNull();
    expect((await kiosk.request('GET', orders)).status).toBe(401);
  });

  it('audits actions with the operator as actor and the device id', async () => {
    const { kiosk, deviceId } = await pairedKiosk(['fnb.order.read', 'fnb.menu.availability']);
    const kai = await membershipOf('kitchen@abc.test');
    expect(
      (await kiosk.request('POST', '/api/v1/kiosk/sign-in', { membershipId: kai, pin: '2468' }))
        .status,
    ).toBe(200);
    const item = Object.values(ctx.world.fnb.MNL.items)[0]!;
    const res = await kiosk.request(
      'PUT',
      `/api/v1/properties/${MNL()}/menu-items/${item}/availability`,
      { available: false },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const app = createPrismaClient({ connectionString: testDatabaseUrls().app, maxConnections: 1 });
    try {
      const org = { organizationId: ctx.world.abc.organizationId, identityId: null };
      const entries = await withDbContext(app, org, (tx) =>
        tx.auditLog.findMany({ where: { deviceId }, orderBy: { occurredAt: 'asc' } }),
      );
      const kaiIdentity = await withDbContext(app, org, (tx) =>
        tx.organizationMembership.findUniqueOrThrow({ where: { id: kai } }),
      );
      expect(entries.map((e) => e.action)).toEqual(
        expect.arrayContaining(['device.paired', 'device.operator_signed_in']),
      );
      const change = entries.find(
        (e) => e.entityType === 'menu_item' || e.action.startsWith('fnb.'),
      );
      expect(change).toMatchObject({ actorType: 'MEMBER', actorId: kaiIdentity.identityId });
    } finally {
      await app.$disconnect();
    }
  });

  it('locks a PIN after five wrong tries', async () => {
    const { kiosk } = await pairedKiosk(['fnb.order.read']);
    const kai = await membershipOf('kitchen@abc.test');
    const signIn = (pin: string) =>
      kiosk.request('POST', '/api/v1/kiosk/sign-in', { membershipId: kai, pin });
    for (let i = 0; i < 4; i++) expect((await signIn('9999')).status).toBe(401);
    expect((await signIn('9999')).status).toBe(401);
    const locked = await signIn('2468');
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('ending device access', () => {
  it('revoking a device, or re-pairing it, cuts the old credentials off', async () => {
    const john2 = await membershipOf('john.gm@abc.test');
    const { kiosk, deviceId } = await pairedKiosk(['fnb.order.read']);
    expect(
      (await kiosk.request('POST', '/api/v1/kiosk/sign-in', { membershipId: john2, pin: '8642' }))
        .status,
    ).toBe(200);
    const orders = `/api/v1/properties/${MNL()}/orders`;
    expect((await kiosk.request('GET', orders)).status).toBe(200);

    const repaired = await john.request('POST', `${devicesUrl()}/${deviceId}/pairing`);
    expect(repaired.status).toBe(201);
    expect((await kiosk.request('GET', orders)).status).toBe(401);
    expect((await kiosk.request('GET', '/api/v1/kiosk')).status).toBe(401);

    const fresh = new Kiosk(ctx.app);
    expect(
      (await fresh.request('POST', '/api/v1/kiosk/pair', { code: repaired.body.pairingCode }))
        .status,
    ).toBe(200);
    const revoked = await john.request('POST', `${devicesUrl()}/${deviceId}/revoke`);
    expect(revoked.body.status).toBe('REVOKED');
    expect((await fresh.request('GET', '/api/v1/kiosk')).status).toBe(401);
    expect((await john.request('POST', `${devicesUrl()}/${deviceId}/pairing`)).status).toBe(409);
  });

  it("changing one's PIN signs them out of every device", async () => {
    const { kiosk } = await pairedKiosk(['fnb.order.read']);
    const johnId = await membershipOf('john.gm@abc.test');
    expect(
      (await kiosk.request('POST', '/api/v1/kiosk/sign-in', { membershipId: johnId, pin: '8642' }))
        .status,
    ).toBe(200);
    expect(
      (await john.request('PUT', '/api/v1/me/pin', { pin: '5793', currentPassword: DEMO_PASSWORD }))
        .status,
    ).toBe(200);
    expect((await kiosk.request('GET', `/api/v1/properties/${MNL()}/orders`)).status).toBe(401);
  });
});
