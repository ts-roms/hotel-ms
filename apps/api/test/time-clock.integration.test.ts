/**
 * Time clock (ADR-0022): a paired TIME_CLOCK device punches employees in and out by
 * Employee ID, with a selfie per punch; managers review the photos; they expire.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ClsService } from 'nestjs-cls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestContext } from '../src/common/request-context.js';
import { TimeClockService } from '../src/modules/hr/time-clock.service.js';
import { startTestApp, type TestContext, TestClient, WEB_ORIGIN, webPunch } from './harness.js';

let ctx: TestContext;
let john: TestClient;
let reception: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const devicesUrl = () => `/api/v1/properties/${MNL()}/devices`;
const E = (no: string) => ctx.world.hr.abc.employees[no]!;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 7)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
/** Today in Manila. */
const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
let ipSeq = 0;

/** A paired device's browser. */
class Device {
  private readonly cookies = new Map<string, string>();
  csrf: string | undefined;
  private readonly ip = `10.88.0.${++ipSeq}`;

  constructor(private readonly app: NestFastifyApplication) {}

  async request(
    method: 'GET' | 'POST',
    url: string,
    body?: object | Buffer,
    headers: Record<string, string> = {},
  ) {
    const res = await this.app.inject({
      method,
      url,
      ...(body === undefined ? {} : { payload: body }),
      headers: {
        origin: WEB_ORIGIN,
        'x-forwarded-for': this.ip,
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(this.csrf && method !== 'GET' ? { 'x-csrf-token': this.csrf } : {}),
        ...headers,
      },
    });
    for (const c of res.cookies) if (c.value) this.cookies.set(c.name, c.value);
    const parsed =
      res.body && String(res.headers['content-type']).includes('json')
        ? JSON.parse(res.body)
        : null;
    if (parsed?.csrfToken) this.csrf = parsed.csrfToken;
    return { status: res.statusCode, body: parsed };
  }

  punch(employeeNo: string, type: string, photo: Buffer = JPEG, contentType = 'image/jpeg') {
    return this.request(
      'POST',
      `/api/v1/kiosk/clock?${new URLSearchParams({ employeeNo, type })}`,
      photo,
      { 'content-type': contentType },
    );
  }
}

async function paired(body: object) {
  const created = await john.request('POST', devicesUrl(), body);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const device = new Device(ctx.app);
  const res = await device.request('POST', '/api/v1/kiosk/pair', {
    code: created.body.pairingCode,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { device, state: res.body };
}

const photoFiles = async () => {
  const dir = join(ctx.env.STORAGE_LOCAL_DIR, ctx.world.abc.organizationId, 'attendance-photos');
  return readdir(dir).catch(() => [] as string[]);
};

let clock: Device;

beforeAll(async () => {
  ctx = await startTestApp();
  john = await TestClient.withMfa(ctx.app, 'john.gm@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('time clock devices', () => {
  it('are registered without permissions, and nobody signs in on them', async () => {
    expect(
      (
        await john.request('POST', devicesUrl(), {
          name: 'Door',
          kind: 'TIME_CLOCK',
          permissions: ['fnb.order.read'],
        })
      ).status,
    ).toBe(400);
    expect(
      (await john.request('POST', devicesUrl(), { name: 'Pass', kind: 'KITCHEN' })).status,
    ).toBe(400);
    const { device, state } = await paired({ name: 'Staff entrance', kind: 'TIME_CLOCK' });
    expect(state.device).toMatchObject({ kind: 'TIME_CLOCK', permissions: [] });
    expect(state.operators).toEqual([]);
    const kai = (await john.get('/api/v1/members')).body.find(
      (m: { email: string }) => m.email === 'kitchen@abc.test',
    ).membershipId;
    expect(
      (await device.request('POST', '/api/v1/kiosk/sign-in', { membershipId: kai, pin: '2468' }))
        .status,
    ).toBe(401);
    clock = device;
  });
});

describe('punching with Employee ID and a selfie', () => {
  it('clocks in, refuses an impossible punch without keeping its photo, and clocks out', async () => {
    const before = (await photoFiles()).length;
    const inRes = await clock.punch('e001', 'IN');
    expect(inRes.status, JSON.stringify(inRes.body)).toBe(201);
    expect(inRes.body).toMatchObject({ type: 'IN', employeeName: expect.any(String) });
    expect((await photoFiles()).length).toBe(before + 1);

    const twice = await clock.punch('E001', 'IN');
    expect(twice.status).toBe(409);
    expect((await photoFiles()).length).toBe(before + 1);

    const breakStart = await clock.punch('E001', 'BREAK_START');
    expect(breakStart.status).toBe(201);
    expect((await clock.punch('E001', 'BREAK_END')).status).toBe(201);
    expect((await clock.punch('E001', 'OUT')).status).toBe(201);
  });

  it('needs a real image, a known Employee ID assigned here, and the device CSRF token', async () => {
    expect((await clock.punch('E002', 'IN', PNG, 'image/jpeg')).status).toBe(415);
    expect((await clock.punch('E002', 'IN', Buffer.from('{}'), 'application/json')).status).toBe(
      415,
    );
    expect((await clock.punch('E002', 'IN', Buffer.alloc(0), 'image/jpeg')).status).toBe(400);
    expect((await clock.punch('E999', 'IN')).status).toBe(404);
    // E005 works at Cebu, not here.
    const elsewhere = await clock.punch('E005', 'IN');
    expect(elsewhere.status).toBe(403);
    const noCsrf = await clock.request(
      'POST',
      `/api/v1/kiosk/clock?employeeNo=E002&type=IN`,
      JPEG,
      { 'content-type': 'image/jpeg', 'x-csrf-token': 'nope' },
    );
    expect(noCsrf.status).toBe(403);
    const anonymous = new Device(ctx.app);
    expect((await anonymous.punch('E002', 'IN')).status).toBe(401);
  });

  it('only time clocks punch; a kitchen tablet cannot', async () => {
    const { device } = await paired({
      name: 'Pass',
      kind: 'KITCHEN',
      permissions: ['fnb.order.read'],
    });
    expect((await device.punch('E002', 'IN')).status).toBe(403);
  });
});

describe('web punches need a selfie too', () => {
  it('refuses a punch without a real photo, and records one with it', async () => {
    const url = `/api/v1/properties/${MNL()}/attendance/punches`;
    // The old JSON punch is no longer accepted.
    expect((await reception.request('POST', `${url}?type=IN`, { type: 'IN' })).status).toBe(415);
    expect(
      (await reception.request('POST', `${url}?type=IN`, PNG, { 'content-type': 'image/jpeg' }))
        .status,
    ).toBe(415);
    expect(
      (await reception.request('POST', url, JPEG, { 'content-type': 'image/jpeg' })).status,
    ).toBe(400);
    const res = await webPunch(reception, `/api/v1/properties/${MNL()}`, 'IN');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ type: 'IN', source: 'WEB' });

    const list = await john.get(
      `/api/v1/properties/${MNL()}/attendance/photos?from=${today()}&to=${today()}`,
    );
    expect(list.body.items).toContainEqual(
      expect.objectContaining({ punchId: res.body.id, source: 'WEB', deviceName: null }),
    );
    // A refused punch keeps no photo.
    const before = (await photoFiles()).length;
    expect((await webPunch(reception, `/api/v1/properties/${MNL()}`, 'IN')).status).toBe(409);
    expect((await photoFiles()).length).toBe(before);
    expect((await webPunch(reception, `/api/v1/properties/${MNL()}`, 'OUT')).status).toBe(201);
  });
});

describe('reviewing and expiring selfies', () => {
  it('managers see who punched with which photo; every view is audited', async () => {
    const list = await john.get(
      `/api/v1/properties/${MNL()}/attendance/photos?from=${today()}&to=${today()}`,
    );
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const mine = list.body.items.filter(
      (p: { employeeId: string; source: string }) =>
        p.employeeId === E('E001') && p.source === 'KIOSK',
    );
    expect(mine.map((p: { type: string }) => p.type).sort()).toEqual(
      ['BREAK_END', 'BREAK_START', 'IN', 'OUT'].sort(),
    );
    expect(mine[0]).toMatchObject({ employeeNo: 'E001', deviceName: 'Staff entrance' });
    expect(
      (
        await reception.get(
          `/api/v1/properties/${MNL()}/attendance/photos?from=${today()}&to=${today()}`,
        )
      ).status,
    ).toBe(403);

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/properties/${MNL()}/attendance/photos/${mine[0].punchId}`,
      headers: { cookie: john.cookieHeader! },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(res.rawPayload, JPEG)).toBe(0);
    const audit = await john.get(`/api/v1/audit-logs?entityType=employee&entityId=${E('E001')}`);
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['attendance.clock_punch', 'attendance.photo_viewed']),
    );
  });

  it('the punches count as attendance', async () => {
    const days = await john.get(
      `/api/v1/properties/${MNL()}/attendance?from=${today()}&to=${today()}`,
    );
    expect(days.status, JSON.stringify(days.body)).toBe(200);
    const day = days.body.items.find((d: { employeeId: string }) => d.employeeId === E('E001'));
    expect(day.firstIn).not.toBeNull();
    expect(day.lastOut).not.toBeNull();
  });

  it('selfies are deleted after 90 days; the punches stay', async () => {
    const cls = ctx.app.get<ClsService<RequestContext>>(ClsService);
    const purged = await cls.run(async () => {
      cls.set('organizationId', ctx.world.abc.organizationId);
      cls.set('system', true);
      return ctx.app.get(TimeClockService).purgePhotos(new Date(Date.now() + 91 * 86_400_000));
    });
    expect(purged).toBeGreaterThanOrEqual(4);
    expect(await photoFiles()).toEqual([]);
    const list = await john.get(
      `/api/v1/properties/${MNL()}/attendance/photos?from=${today()}&to=${today()}`,
    );
    expect(list.body.items).toEqual([]);
    const days = await john.get(
      `/api/v1/properties/${MNL()}/attendance?from=${today()}&to=${today()}`,
    );
    expect(
      days.body.items.find((d: { employeeId: string }) => d.employeeId === E('E001')).firstIn,
    ).not.toBeNull();
  });
});

describe('photo retention setting', () => {
  it('is 90 days by default, set by HR at organization scope, and drives the purge', async () => {
    const admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
    const url = '/api/v1/attendance-photo-retention';
    expect((await john.get(url)).body).toEqual({ days: 90 });
    expect((await reception.get(url)).status).toBe(403);
    // John manages attendance at Manila only: an organization policy is not his to set.
    expect((await john.request('PUT', url, { days: 30 })).status).toBe(403);
    expect((await admin.request('PUT', url, { days: 3 })).status).toBe(400);
    expect((await admin.request('PUT', url, { days: 400 })).status).toBe(400);
    const set = await admin.request('PUT', url, { days: 30 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect((await john.get(url)).body).toEqual({ days: 30 });
    expect((await reception.get('/api/v1/me/employee')).body.photoRetentionDays).toBe(30);
    expect((await clock.request('GET', '/api/v1/kiosk')).body.photoRetentionDays).toBe(30);

    expect((await webPunch(reception, `/api/v1/properties/${MNL()}`, 'IN')).status).toBe(201);
    const cls = ctx.app.get<ClsService<RequestContext>>(ClsService);
    const purge = (days: number) =>
      cls.run(async () => {
        cls.set('organizationId', ctx.world.abc.organizationId);
        cls.set('system', true);
        return ctx.app.get(TimeClockService).purgePhotos(new Date(Date.now() + days * 86_400_000));
      });
    expect(await purge(29)).toBe(0);
    expect(await purge(31)).toBe(1);
  });
});
