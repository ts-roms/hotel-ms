/**
 * Management layer (ADR-0025): the group and property dashboards show only what each role
 * may see; reports and CSV exports; global search within the caller's permissions.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let john: TestClient;
let reception: TestClient;
let hk: TestClient;
let xyzAdmin: TestClient;
let confirmationNo: string;

const P = () => ctx.world.abc.properties;
const base = (p = P().MNL) => `/api/v1/properties/${p}`;
const inv = () => ctx.world.inventory.MNL;
const idem = () => ({ 'idempotency-key': `test-${randomUUID()}` });
const range = (from: string, to: string) => `from=${from}&to=${to}`;
let today: string;
/** Real calendar date in Manila (the demo business date runs ahead of it). */
const calendarToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  john = await TestClient.withMfa(ctx.app, 'john.gm@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
  xyzAdmin = await TestClient.withMfa(ctx.app, 'admin@xyz.test');
  today = (await john.get(base())).body.currentBusinessDate;

  // A guest in house with a room charge, a room-service order and a guest request.
  const booking = await reception.request(
    'POST',
    `${base()}/reservations`,
    {
      source: 'DIRECT',
      booker: {
        newGuest: { firstName: 'Dora', lastName: 'Dashboard', email: 'dora@example.test' },
      },
      rooms: [
        {
          roomTypeId: inv().roomTypes.STD,
          ratePlanId: inv().ratePlans.BAR,
          arrivalDate: today,
          departureDate: '2026-10-03',
          adults: 1,
          roomId: inv().rooms['101'],
        },
      ],
    },
    idem(),
  );
  expect(booking.status, JSON.stringify(booking.body)).toBe(201);
  confirmationNo = booking.body.confirmationNo;
  const line = `${base()}/reservations/${booking.body.id}/rooms/${booking.body.rooms[0].id}`;
  expect((await reception.request('POST', `${line}/check-in`)).status).toBe(200);
  const order = await reception.request(
    'POST',
    `${base()}/orders`,
    {
      outletId: ctx.world.fnb.MNL.outlets.IRD,
      chargeMethod: 'ROOM_CHARGE',
      roomId: inv().rooms['101'],
      items: [{ menuItemId: ctx.world.fnb.MNL.items['Iced Tea'], quantity: 3 }],
    },
    idem(),
  );
  expect(order.status, JSON.stringify(order.body)).toBe(201);
  const request = await reception.request('POST', `${base()}/service-requests`, {
    roomId: inv().rooms['101'],
    category: 'TOWELS',
    description: 'Two more towels',
  });
  expect(request.status, JSON.stringify(request.body)).toBe(201);
  const done = await reception.request(
    'PATCH',
    `${base()}/service-requests/${request.body.id}`,
    { status: 'DONE' },
    { 'if-match': `W/"${request.body.version}"` },
  );
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  // Something billed today (room nights post at the night audit).
  const folio = (await reception.get(`${line}/folio`)).body;
  const charge = await reception.request(
    'POST',
    `${base()}/folios/${folio.id}/charges`,
    { department: 'MINIBAR', description: 'Minibar', amountMinor: 25_000 },
    idem(),
  );
  expect(charge.status, JSON.stringify(charge.body)).toBe(200);
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('dashboards', () => {
  it('the group dashboard shows each role only its properties and sections', async () => {
    const group = await admin.get('/api/v1/dashboard');
    expect(group.status).toBe(200);
    expect(group.body.properties.map((p: { code: string }) => p.code).sort()).toEqual([
      'CEB',
      'DVO',
      'MNL',
    ]);
    const mnl = group.body.properties.find((p: { code: string }) => p.code === 'MNL');
    expect(mnl).toMatchObject({ occupiedRooms: 1, revenueTodayMinor: expect.any(Number) });
    expect(mnl.headcount).toBeGreaterThan(0);
    expect(group.body.totals).toMatchObject({ currency: 'PHP', occupiedRooms: 1 });

    // John runs Manila only.
    const johns = (await john.get('/api/v1/dashboard')).body;
    expect(johns.properties.map((p: { code: string }) => p.code)).toEqual(['MNL']);
    // The front desk sees rooms but no money.
    const desk = (await reception.get('/api/v1/dashboard')).body.properties[0];
    expect(desk).toMatchObject({ code: 'MNL', occupiedRooms: 1, revenueTodayMinor: null });
    // Another organization sees only its own.
    const xyz = (await xyzAdmin.get('/api/v1/dashboard')).body;
    expect(xyz.properties.map((p: { code: string }) => p.code)).toEqual(['BOR']);
  });

  it('the property dashboard is today at a glance, by permission', async () => {
    const full = await john.get(`${base()}/dashboard`);
    expect(full.status, JSON.stringify(full.body)).toBe(200);
    expect(full.body.rooms).toMatchObject({ occupied: 1, arrivalsCheckedIn: 1 });
    expect(full.body.revenue.todayMinor).toBeGreaterThan(0);
    expect(full.body.staff).not.toBeNull();
    expect(full.body.operations).toMatchObject({ activeFoodOrders: 1 });
    expect(full.body.hr).not.toBeNull();

    const housekeeping = (await hk.get(`${base()}/dashboard`)).body;
    expect(housekeeping.rooms).toBeNull();
    expect(housekeeping.revenue).toBeNull();
    expect(housekeeping.staff).toBeNull();
    expect(housekeeping.operations).not.toBeNull();

    expect((await john.get(`${base(P().CEB)}/dashboard`)).status).toBe(404);
  });
});

describe('reports', () => {
  it('occupancy, ADR and RevPAR come from closed business days', async () => {
    const run = await admin.request('POST', `${base()}/night-audit`, { businessDate: today });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    const report = await john.get(`${base()}/reports/occupancy?${range(calendarToday(), today)}`);
    expect(report.status, JSON.stringify(report.body)).toBe(200);
    expect(report.body.closedDays).toBe(1);
    expect(report.body.days[0]).toMatchObject({
      date: today,
      roomsSold: 1,
      roomsAvailable: run.body.stats.roomsAvailable,
      roomRevenueMinor: run.body.stats.roomRevenueMinor,
      adrMinor: run.body.stats.adrMinor,
    });
    expect(report.body.totals.reservationsMade).toBeGreaterThanOrEqual(1);
    expect((await reception.get(`${base()}/reports/occupancy?${range(today, today)}`)).status).toBe(
      403,
    );

    const csv = await ctx.app.inject({
      method: 'GET',
      url: `${base()}/reports/occupancy/export?${range(today, today)}`,
      headers: { cookie: john.cookieHeader! },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\r\n')[0]).toBe(
      'date,rooms_available,rooms_sold,occupancy_pct,room_revenue_PHP,adr,revpar,arrivals,departures,no_shows',
    );
    expect(csv.body).toContain(`${today},`);
    expect(
      (await john.get(`${base()}/reports/occupancy?${range(today, '2025-01-01')}`)).status,
    ).toBe(400);
  });

  it('F&B, guest services and HR summarize the period', async () => {
    // Orders and requests count by when they were placed (the real calendar date here).
    const window = range(calendarToday(), today);
    const fnb = (await john.get(`${base()}/reports/fnb?${window}`)).body;
    expect(fnb).toMatchObject({ orders: 1, cancelled: 0 });
    expect(fnb.roomChargedMinor).toBe(fnb.salesMinor);
    expect(fnb.roomServiceSalesMinor).toBe(fnb.salesMinor);
    expect(fnb.topItems[0]).toMatchObject({ name: 'Iced Tea', quantity: 3 });

    const services = (await reception.get(`${base()}/reports/guest-services?${window}`)).body;
    expect(services).toMatchObject({ requests: 1, completed: 1, open: 0 });
    expect(services.byCategory[0]).toMatchObject({ category: 'TOWELS', requests: 1 });

    const hr = await john.get(`${base()}/reports/hr?${range(today, today)}`);
    expect(hr.status, JSON.stringify(hr.body)).toBe(200);
    expect(hr.body.headcount).toBeGreaterThan(0);
    expect(hr.body.byDepartment.length).toBeGreaterThan(0);
    expect((await hk.get(`${base()}/reports/hr?${range(today, today)}`)).status).toBe(403);
  });
});

describe('global search', () => {
  it('finds reservations, guests, rooms and employees the caller may see', async () => {
    const byNumber = await reception.get(`/api/v1/search?q=${confirmationNo}`);
    expect(byNumber.status).toBe(200);
    expect(byNumber.body.items).toContainEqual(
      expect.objectContaining({ kind: 'reservation', title: confirmationNo }),
    );
    const byGuest = (await reception.get('/api/v1/search?q=dashboard')).body.items;
    expect(byGuest).toContainEqual(
      expect.objectContaining({ kind: 'guest', title: 'Dora Dashboard' }),
    );
    const rooms = (await reception.get('/api/v1/search?q=10')).body.items;
    expect(rooms.some((i: { kind: string }) => i.kind === 'room')).toBe(true);

    const people = (await admin.get('/api/v1/search?q=E001')).body.items;
    expect(people).toContainEqual(expect.objectContaining({ kind: 'employee' }));
    // Reception has no employee.read; housekeeping cannot see reservations.
    expect(
      (await reception.get('/api/v1/search?q=E001')).body.items.some(
        (i: { kind: string }) => i.kind === 'employee',
      ),
    ).toBe(false);
    expect(
      (await hk.get(`/api/v1/search?q=${confirmationNo}`)).body.items.some(
        (i: { kind: string }) => i.kind === 'reservation',
      ),
    ).toBe(false);
    // Nothing crosses organizations.
    expect((await xyzAdmin.get(`/api/v1/search?q=${confirmationNo}`)).body.items).toEqual([]);
    expect((await reception.get('/api/v1/search?q=a')).status).toBe(400);
  });
});
