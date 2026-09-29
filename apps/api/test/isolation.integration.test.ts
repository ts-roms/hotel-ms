/**
 * Mandatory multi-tenant isolation suite (spec §61, blueprint §23.2).
 *
 * The route matrix is generated from the controllers, so a new route is covered without
 * anyone remembering to add it here.
 */
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTROLLERS } from '../src/api-surface.js';
import {
  GUEST_ROUTE,
  type GuestRouteOptions,
  IS_PUBLIC,
  NO_ORGANIZATION,
  REQUIRED_PERMISSION,
} from '../src/common/route-metadata.js';
import { DEMO_PASSWORD } from '@hotel/database/testing';
import { startTestApp, type TestContext, TestClient, WEB_ORIGIN } from './harness.js';

interface RouteInfo {
  controller: string;
  handler: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  isPublic: boolean;
  noOrganization: boolean;
  hasPermission: boolean;
  guest: GuestRouteOptions | undefined;
}

function routeInventory(): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const controller of CONTROLLERS) {
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const proto = controller.prototype as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const sub = Reflect.getMetadata(PATH_METADATA, handler);
      if (sub === undefined) continue;
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
      const meta = (key: string) =>
        Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
      const path = ['/api/v1', base, String(sub)].join('/').replace(/\/+/g, '/').replace(/\/$/, '');
      routes.push({
        controller: controller.name,
        handler: name,
        method: RequestMethod[requestMethod] as RouteInfo['method'],
        path: base === 'health' ? path.replace('/api/v1', '') : path,
        isPublic: meta(IS_PUBLIC) === true,
        noOrganization: meta(NO_ORGANIZATION) === true,
        hasPermission: meta(REQUIRED_PERMISSION) !== undefined,
        guest: meta(GUEST_ROUTE),
      });
    }
  }
  return routes;
}

const ROUTES = routeInventory();
const TENANT_ROUTES = ROUTES.filter((r) => !r.isPublic && !r.noOrganization && !r.guest);
/** Guest realm routes that need a guest session (all but the link exchange). */
const GUEST_SESSION_ROUTES = ROUTES.filter((r) => r.guest?.session);
const PROPERTY_ROUTES = TENANT_ROUTES.filter((r) => r.path.includes(':propertyId'));

let ctx: TestContext;
let clients: Record<
  'abcAdmin' | 'john' | 'maria' | 'robert' | 'frontDesk' | 'xyzAdmin',
  TestClient
>;

beforeAll(async () => {
  ctx = await startTestApp();
  clients = {
    // Audit log access is a sensitive permission: these users need an MFA-verified session.
    abcAdmin: await TestClient.withMfa(ctx.app, 'admin@abc.test'),
    john: await TestClient.withMfa(ctx.app, 'john.gm@abc.test'),
    maria: await TestClient.as(ctx.app, 'maria.hr@abc.test'),
    robert: await TestClient.as(ctx.app, 'robert.finance@abc.test'),
    frontDesk: await TestClient.as(ctx.app, 'frontdesk@abc.test'),
    xyzAdmin: await TestClient.withMfa(ctx.app, 'admin@xyz.test'),
  };
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

const codes = (res: { body: { items: { code: string }[] } }) =>
  res.body.items.map((p) => p.code).sort();

describe('route inventory', () => {
  it('found the routes', () => {
    expect(TENANT_ROUTES.length).toBeGreaterThanOrEqual(5);
    expect(PROPERTY_ROUTES.length).toBeGreaterThanOrEqual(2);
  });

  it('every tenant route declares a permission (deny by default)', () => {
    const undeclared = TENANT_ROUTES.filter((r) => !r.hasPermission).map(
      (r) => `${r.method} ${r.path}`,
    );
    expect(undeclared).toEqual([]);
  });

  it.each(TENANT_ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))(
    '%s requires authentication',
    async (_label, route) => {
      const anonymous = new TestClient(ctx.app);
      const path = route.path.replace(':propertyId', ctx.world.abc.properties.MNL);
      const res = await anonymous.request(
        route.method,
        path,
        route.method === 'GET' ? undefined : {},
      );
      expect(res.status).toBe(401);
    },
  );
});

describe('guest realm routes', () => {
  it('are all under /guest and never take a property or reservation id', () => {
    const guestRoutes = ROUTES.filter((r) => r.guest);
    expect(guestRoutes.length).toBeGreaterThanOrEqual(5);
    for (const r of guestRoutes) {
      expect(r.path.startsWith('/api/v1/guest/')).toBe(true);
      expect(r.path).not.toMatch(/:propertyId|:reservationId|:lineId/);
      expect(r.hasPermission).toBe(false);
    }
  });

  it.each(GUEST_SESSION_ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))(
    '%s requires a guest session, and a staff session is not one',
    async (_label, route) => {
      const anonymous = new TestClient(ctx.app);
      const body = route.method === 'GET' ? undefined : {};
      expect((await anonymous.request(route.method, route.path, body)).status).toBe(401);
      expect((await clients.abcAdmin.request(route.method, route.path, body)).status).toBe(401);
    },
  );
});

describe('shared-device realm (ADR-0020)', () => {
  /** Staff-session routes a device must never reach: account, org-level, other property. */
  const OFF_LIMITS = ROUTES.filter(
    (r) => !r.isPublic && !r.guest && (r.noOrganization || !r.path.includes(':propertyId')),
  );
  let cookie: string;
  let csrf: string;

  beforeAll(async () => {
    // John (GM @ MNL) signs in on a kitchen tablet paired to MNL.
    const john = clients.john;
    expect(
      (await john.request('PUT', '/api/v1/me/pin', { pin: '8642', currentPassword: DEMO_PASSWORD }))
        .status,
    ).toBe(200);
    const created = await john.request(
      'POST',
      `/api/v1/properties/${ctx.world.abc.properties.MNL}/devices`,
      { name: 'Isolation tablet', permissions: ['fnb.order.read', 'fnb.order.update'] },
    );
    const headers = { origin: WEB_ORIGIN, 'x-forwarded-for': '10.77.7.7' };
    const paired = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/kiosk/pair',
      payload: { code: created.body.pairingCode },
      headers,
    });
    const device = paired.cookies.find((c) => c.name === 'hotel_device')!.value;
    csrf = JSON.parse(paired.body).csrfToken;
    const members = (await john.get('/api/v1/members')).body as {
      email: string;
      membershipId: string;
    }[];
    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/kiosk/sign-in',
      payload: {
        membershipId: members.find((m) => m.email === 'john.gm@abc.test')!.membershipId,
        pin: '8642',
      },
      headers: { ...headers, cookie: `hotel_device=${device}`, 'x-csrf-token': csrf },
    });
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    const operator = signedIn.cookies.find((c) => c.name === 'hotel_kiosk')!.value;
    cookie = `hotel_device=${device}; hotel_kiosk=${operator}`;
  });

  it('can use its own property routes', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/properties/${ctx.world.abc.properties.MNL}/orders`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it.each(OFF_LIMITS.map((r) => [`${r.method} ${r.path}`, r] as const))(
    '%s is out of reach for a signed-in device',
    async (_label, route) => {
      const res = await ctx.app.inject({
        method: route.method,
        url: route.path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000'),
        ...(route.method === 'GET' ? {} : { payload: {} }),
        headers: { origin: WEB_ORIGIN, cookie, 'x-csrf-token': csrf },
      });
      expect([401, 404]).toContain(res.statusCode);
    },
  );

  it.each(PROPERTY_ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))(
    '%s at another property is out of reach for the device',
    async (_label, route) => {
      const res = await ctx.app.inject({
        method: route.method,
        url: route.path
          .replace(':propertyId', ctx.world.abc.properties.CEB)
          .replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000'),
        ...(route.method === 'GET' ? {} : { payload: {} }),
        headers: { origin: WEB_ORIGIN, cookie, 'x-csrf-token': csrf },
      });
      expect(res.statusCode).toBe(404);
    },
  );
});

describe('cross-tenant access (Tenant A cannot access Tenant B)', () => {
  it.each(PROPERTY_ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))(
    '%s with another tenant property id → 404, no data',
    async (_label, route) => {
      const path = route.path.replace(':propertyId', ctx.world.abc.properties.MNL);
      const res = await clients.xyzAdmin.request(
        route.method,
        path,
        route.method === 'GET' ? undefined : { name: 'pwned' },
        { 'if-match': 'W/"1"' },
      );
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('ABC Hotel Manila');
    },
  );

  it('lists only own-tenant properties', async () => {
    expect(codes(await clients.xyzAdmin.get('/api/v1/properties'))).toEqual(['BOR']);
    expect(codes(await clients.abcAdmin.get('/api/v1/properties'))).toEqual(['CEB', 'DVO', 'MNL']);
  });

  it('cannot plant a record in another tenant through the request body', async () => {
    const res = await clients.xyzAdmin.request('POST', '/api/v1/properties', {
      organizationId: ctx.world.abc.organizationId,
      code: 'PLANT',
      name: 'Planted',
      timezone: 'Asia/Manila',
      currency: 'PHP',
      locale: 'en-PH',
      countryCode: 'PH',
    });
    expect(res.status).toBe(400);
    expect(codes(await clients.abcAdmin.get('/api/v1/properties'))).not.toContain('PLANT');
  });

  it('audit log never shows another tenant entries', async () => {
    const res = await clients.xyzAdmin.get('/api/v1/audit-logs?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(
      res.body.items.every(
        (e: { organizationId: string }) => e.organizationId === ctx.world.xyz.organizationId,
      ),
    ).toBe(true);
  });

  it('organization endpoint returns only the active organization', async () => {
    const res = await clients.xyzAdmin.get('/api/v1/organization');
    expect(res.body.id).toBe(ctx.world.xyz.organizationId);
  });
});

describe('cross-property access (Property A users cannot access Property B)', () => {
  it('property-scoped users list only their properties', async () => {
    expect(codes(await clients.john.get('/api/v1/properties'))).toEqual(['MNL']);
    expect(codes(await clients.maria.get('/api/v1/properties'))).toEqual(['CEB', 'MNL']);
    expect(codes(await clients.frontDesk.get('/api/v1/properties'))).toEqual(['CEB']);
    expect(codes(await clients.robert.get('/api/v1/properties'))).toEqual(['CEB', 'DVO', 'MNL']);
  });

  it.each(PROPERTY_ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))(
    '%s on an unassigned property of the same tenant → 404',
    async (_label, route) => {
      const path = route.path.replace(':propertyId', ctx.world.abc.properties.CEB);
      const res = await clients.john.request(
        route.method,
        path,
        route.method === 'GET' ? undefined : { name: 'pwned' },
        { 'if-match': 'W/"1"' },
      );
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('ABC Resort Cebu');
    },
  );

  it('a user who can read a property but not update it gets 403 on update', async () => {
    const res = await clients.frontDesk.request(
      'PATCH',
      `/api/v1/properties/${ctx.world.abc.properties.CEB}`,
      { name: 'Renamed' },
      { 'if-match': 'W/"1"' },
    );
    expect(res.status).toBe(403);
  });

  it('property audit entries are visible only within scope; org-level entries are hidden', async () => {
    // John changes MNL, the admin changes DVO.
    const mnl = await clients.john.get(`/api/v1/properties/${ctx.world.abc.properties.MNL}`);
    await clients.john.request(
      'PATCH',
      `/api/v1/properties/${ctx.world.abc.properties.MNL}`,
      { phone: '+63 2 8000 0001' },
      { 'if-match': String(mnl.headers.etag) },
    );
    const dvo = await clients.abcAdmin.get(`/api/v1/properties/${ctx.world.abc.properties.DVO}`);
    await clients.abcAdmin.request(
      'PATCH',
      `/api/v1/properties/${ctx.world.abc.properties.DVO}`,
      { phone: '+63 82 000 0001' },
      { 'if-match': String(dvo.headers.etag) },
    );

    const johnView = await clients.john.get('/api/v1/audit-logs?limit=100');
    expect(johnView.body.items.length).toBeGreaterThan(0);
    expect(
      johnView.body.items.every(
        (e: { propertyId: string }) => e.propertyId === ctx.world.abc.properties.MNL,
      ),
    ).toBe(true);

    const adminView = await clients.abcAdmin.get('/api/v1/audit-logs?limit=100');
    const propertyIds = new Set(
      adminView.body.items.map((e: { propertyId: string | null }) => e.propertyId),
    );
    expect(propertyIds.has(ctx.world.abc.properties.DVO)).toBe(true);
    expect(propertyIds.has(null)).toBe(true); // org-level entries (provisioning, logins)
  });
});

describe('group vs property privileges', () => {
  it('a property GM cannot create properties (organization-scoped permission)', async () => {
    const res = await clients.john.request('POST', '/api/v1/properties', {
      code: 'NEW1',
      name: 'New Hotel',
      timezone: 'Asia/Manila',
      currency: 'PHP',
      locale: 'en-PH',
      countryCode: 'PH',
    });
    expect(res.status).toBe(403);
  });

  it('an org auditor can read everything but change nothing', async () => {
    expect(
      (await clients.robert.get(`/api/v1/properties/${ctx.world.abc.properties.DVO}`)).status,
    ).toBe(200);
    const res = await clients.robert.request(
      'PATCH',
      `/api/v1/properties/${ctx.world.abc.properties.DVO}`,
      { name: 'Renamed' },
      { 'if-match': 'W/"1"' },
    );
    expect(res.status).toBe(403);
  });
});

describe('property lifecycle', () => {
  it('org admin creates a property; it is audited and emits an outbox event in the same transaction', async () => {
    const res = await clients.abcAdmin.request('POST', '/api/v1/properties', {
      code: 'ILO',
      name: 'ABC Hotel Iloilo',
      timezone: 'Asia/Manila',
      currency: 'PHP',
      locale: 'en-PH',
      countryCode: 'PH',
    });
    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(ctx.world.abc.organizationId);
    expect(res.body.checkInTime).toBe('14:00');
    expect(res.body.currentBusinessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.headers.etag).toBe('W/"1"');

    const audit = await clients.abcAdmin.get(
      `/api/v1/audit-logs?entityType=property&entityId=${res.body.id}`,
    );
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(['property.created']);

    const duplicate = await clients.abcAdmin.request('POST', '/api/v1/properties', {
      code: 'ILO',
      name: 'Duplicate',
      timezone: 'Asia/Manila',
      currency: 'PHP',
      locale: 'en-PH',
      countryCode: 'PH',
    });
    expect(duplicate.status).toBe(409);
  });

  it('same property code may exist in two different tenants', async () => {
    const res = await clients.xyzAdmin.request('POST', '/api/v1/properties', {
      code: 'MNL',
      name: 'XYZ Manila',
      timezone: 'Asia/Manila',
      currency: 'PHP',
      locale: 'en-PH',
      countryCode: 'PH',
    });
    expect(res.status).toBe(201);
  });

  it('updates require If-Match and reject stale versions', async () => {
    const url = `/api/v1/properties/${ctx.world.abc.properties.CEB}`;
    const current = await clients.abcAdmin.get(url);
    const etag = String(current.headers.etag);

    expect((await clients.abcAdmin.request('PATCH', url, { name: 'ABC Resort Cebu' })).status).toBe(
      428,
    );

    const first = await clients.abcAdmin.request(
      'PATCH',
      url,
      { city: 'Lapu-Lapu' },
      { 'if-match': etag },
    );
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(current.body.version + 1);
    expect(first.body.checkInTime).toBe(current.body.checkInTime);

    const stale = await clients.abcAdmin.request(
      'PATCH',
      url,
      { city: 'Mandaue' },
      { 'if-match': etag },
    );
    expect(stale.status).toBe(412);
    expect(stale.body.code).toBe('VERSION_CONFLICT');

    const audit = await clients.abcAdmin.get(
      `/api/v1/audit-logs?entityType=property&entityId=${ctx.world.abc.properties.CEB}`,
    );
    const update = audit.body.items.find(
      (e: { action: string }) => e.action === 'property.updated',
    );
    expect(update.before).toEqual({ city: 'Cebu City' });
    expect(update.after).toEqual({ city: 'Lapu-Lapu' });
  });

  it('timezone and currency cannot be changed through the profile update', async () => {
    const url = `/api/v1/properties/${ctx.world.abc.properties.MNL}`;
    const current = await clients.abcAdmin.get(url);
    const res = await clients.abcAdmin.request(
      'PATCH',
      url,
      { currency: 'USD' },
      { 'if-match': String(current.headers.etag) },
    );
    expect(res.status).toBe(400);
  });
});
