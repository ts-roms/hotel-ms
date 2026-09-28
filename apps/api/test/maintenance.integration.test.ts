/**
 * Maintenance and lost & found (ADR-0023): reporting, the technician workflow with its
 * history, rooms taken out of order and given back, photos; lost items held and returned.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SELFIE, startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let john: TestClient;
let hk: TestClient;
let reception: TestClient;
let kitchen: TestClient;
let tech: TestClient;
let techMembership: string;

const MNL = () => ctx.world.abc.properties.MNL;
const CEB = () => ctx.world.abc.properties.CEB;
const base = () => `/api/v1/properties/${MNL()}`;
const room = (n: string) => ctx.world.inventory.MNL.rooms[n]!;
const ifMatch = (version: number) => ({ 'if-match': `W/"${version}"` });
/** Today's business date at Manila. */
let today: string;
const plusDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  john = await TestClient.withMfa(ctx.app, 'john.gm@abc.test');
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  kitchen = await TestClient.as(ctx.app, 'kitchen@abc.test');
  // Rudy (room-service runner) also works as a maintenance technician at Manila.
  const roles = (await admin.get('/api/v1/roles')).body as { key: string; id: string }[];
  const members = (await admin.get('/api/v1/members')).body as {
    email: string;
    membershipId: string;
  }[];
  techMembership = members.find((m) => m.email === 'runner@abc.test')!.membershipId;
  const granted = await admin.request(
    'POST',
    `/api/v1/members/${techMembership}/role-assignments`,
    { roleId: roles.find((r) => r.key === 'maintenance_technician')!.id, propertyId: MNL() },
  );
  expect(granted.status, JSON.stringify(granted.body)).toBe(201);
  tech = await TestClient.as(ctx.app, 'runner@abc.test');
  today = (await john.get(`/api/v1/properties/${MNL()}`)).body.currentBusinessDate;
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('maintenance requests', () => {
  let leak: { id: string; version: number };

  it('anyone who reports can file one; only managers take rooms out of order', async () => {
    const res = await hk.request('POST', `${base()}/maintenance`, {
      roomId: room('101'),
      category: 'PLUMBING',
      priority: 'HIGH',
      title: 'Leaking tap',
      description: 'Bathroom sink drips constantly.',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      requestNo: expect.stringMatching(/^MR-\d{5}$/),
      roomNumber: '101',
      status: 'OPEN',
      reportedByName: 'Hana Housekeeper',
      assignedName: null,
      outOfOrder: null,
    });
    leak = res.body;

    expect(
      (
        await hk.request('POST', `${base()}/maintenance`, {
          category: 'OTHER',
          title: 'Somewhere',
        })
      ).status,
    ).toBe(400);
    const lobby = await hk.request('POST', `${base()}/maintenance`, {
      location: 'Lobby elevator',
      category: 'APPLIANCE',
      title: 'Elevator door slow',
    });
    expect(lobby.status).toBe(201);
    expect(
      (
        await hk.request('POST', `${base()}/maintenance`, {
          roomId: room('102'),
          category: 'HVAC',
          title: 'No cooling',
          outOfOrder: { startDate: today, endDate: plusDays(today, 2) },
        })
      ).status,
    ).toBe(403);
    expect((await kitchen.get(`${base()}/maintenance`)).status).toBe(403);
    expect((await john.get(`/api/v1/properties/${CEB()}/maintenance`)).status).toBe(404);

    const list = await reception.get(`${base()}/maintenance`);
    expect(list.status).toBe(200);
    // Most urgent first.
    expect(list.body.items[0].id).toBe(leak.id);
  });

  it('follows assign → start → hold → start → complete, with a full history', async () => {
    const act = (client: TestClient, body: object, version = leak.version) =>
      client.request('POST', `${base()}/maintenance/${leak.id}/actions`, body, ifMatch(version));

    const techs = await john.get(`${base()}/maintenance/technicians`);
    expect(techs.body.items).toContainEqual({
      membershipId: techMembership,
      displayName: 'Rudy Runner',
    });
    expect((await hk.get(`${base()}/maintenance/technicians`)).status).toBe(403);

    expect((await act(hk, { action: 'ASSIGN', membershipId: techMembership })).status).toBe(403);
    expect(
      (await act(john, { action: 'ASSIGN', membershipId: ctx.world.abc.organizationId })).status,
    ).toBe(400);
    const assigned = await act(john, { action: 'ASSIGN', membershipId: techMembership });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect(assigned.body).toMatchObject({ status: 'ASSIGNED', assignedName: 'Rudy Runner' });
    // A stale version is refused.
    expect((await act(tech, { action: 'START' }, leak.version)).status).toBe(412);
    leak = assigned.body;

    const started = await act(tech, { action: 'START' });
    expect(started.body.status).toBe('IN_PROGRESS');
    expect(started.body.startedAt).not.toBeNull();
    leak = started.body;
    expect((await act(hk, { action: 'NOTE', note: 'Hurry' })).status).toBe(403);
    expect((await act(tech, { action: 'HOLD' })).status).toBe(400);
    const held = await act(tech, { action: 'HOLD', note: 'Waiting for a washer' });
    expect(held.body.status).toBe('ON_HOLD');
    leak = held.body;
    expect((await act(tech, { action: 'COMPLETE', note: 'Done' })).status).toBe(409);
    leak = (await act(tech, { action: 'START' })).body;
    const noted = await act(tech, { action: 'NOTE', note: 'Washer arrived' });
    leak = noted.body;
    const done = await act(tech, { action: 'COMPLETE', note: 'Replaced the washer.' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: 'DONE', resolution: 'Replaced the washer.' });
    expect(done.body.completedAt).not.toBeNull();
    leak = done.body;
    expect((await act(john, { action: 'CANCEL', note: 'x-x' })).status).toBe(409);

    const detail = await reception.get(`${base()}/maintenance/${leak.id}`);
    expect(
      detail.body.updates.map((u: { kind: string; toStatus: string | null }) =>
        u.toStatus ? `${u.kind}:${u.toStatus}` : u.kind,
      ),
    ).toEqual([
      'CREATED:OPEN',
      'ASSIGNED:ASSIGNED',
      'STATUS:IN_PROGRESS',
      'STATUS:ON_HOLD',
      'STATUS:IN_PROGRESS',
      'NOTE',
      'STATUS:DONE',
    ]);
    expect(detail.body.updates[1]).toMatchObject({ byName: 'John Reyes', note: 'Rudy Runner' });
  });

  it('takes a room out of order while open, and gives it back when closed', async () => {
    const blocks = () => john.get(`${base()}/rooms/${room('103')}/blocks`);
    const created = await john.request('POST', `${base()}/maintenance`, {
      roomId: room('103'),
      category: 'HVAC',
      priority: 'URGENT',
      title: 'No cooling',
      outOfOrder: { startDate: today, endDate: plusDays(today, 2) },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.outOfOrder).toMatchObject({
      startDate: today,
      endDate: plusDays(today, 2),
      released: false,
    });
    const active = (await blocks()).body.find(
      (b: { id: string }) => b.id === created.body.outOfOrder.blockId,
    );
    expect(active).toMatchObject({ released: false });

    const cancelled = await john.request(
      'POST',
      `${base()}/maintenance/${created.body.id}/actions`,
      { action: 'CANCEL', note: 'Fixed by a reset' },
      ifMatch(created.body.version),
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', outOfOrder: { released: true } });
  });

  it('keeps photos of the problem', async () => {
    const all = (await reception.get(`${base()}/maintenance?status=ALL`)).body.items;
    expect(all.map((r: { status: string }) => r.status).sort()).toEqual(
      ['CANCELLED', 'DONE', 'OPEN'].sort(),
    );
    const lobby = (await reception.get(`${base()}/maintenance`)).body.items.find(
      (r: { location: string | null }) => r.location === 'Lobby elevator',
    );
    const url = `${base()}/maintenance/${lobby.id}/photos`;
    const photo = (client: TestClient, body: Buffer, type = 'image/jpeg') =>
      client.request('POST', url, body, { 'content-type': type });
    expect((await photo(hk, Buffer.from('not an image'))).status).toBe(415);
    expect((await photo(kitchen, SELFIE)).status).toBe(403);
    const added = await photo(hk, SELFIE);
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body.photoCount).toBe(1);
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${url}/${added.body.photos[0].id}`,
      headers: { cookie: reception.cookieHeader! },
    });
    expect(res.statusCode).toBe(200);
    expect(Buffer.compare(res.rawPayload, SELFIE)).toBe(0);
  });
});

describe('lost & found', () => {
  it('logs items where they were found, and returns them with a record of to whom', async () => {
    const url = `${base()}/lost-found`;
    const logged = await hk.request('POST', url, {
      description: 'Black leather wallet',
      category: 'VALUABLES',
      foundLocation: 'Room 101, under the bed',
      roomId: room('101'),
      storageLocation: 'Front office safe',
    });
    expect(logged.status, JSON.stringify(logged.body)).toBe(201);
    expect(logged.body).toMatchObject({
      itemNo: expect.stringMatching(/^LF-\d{5}$/),
      status: 'HELD',
      roomNumber: '101',
      foundByName: 'Hana Housekeeper',
    });
    expect((await kitchen.get(url)).status).toBe(403);
    expect((await hk.get(`${url}?q=wallet`)).body.items).toHaveLength(1);
    expect((await hk.get(`${url}?q=umbrella`)).body.items).toHaveLength(0);

    const close = (client: TestClient, body: object, version = logged.body.version) =>
      client.request('POST', `${url}/${logged.body.id}/close`, body, ifMatch(version));
    expect((await close(hk, { status: 'RETURNED', note: 'To the guest in 101' })).status).toBe(403);
    expect((await close(reception, { status: 'RETURNED', note: 'x' })).status).toBe(400);
    const returned = await close(reception, {
      status: 'RETURNED',
      note: 'To Mr. Cruz, room 101; ID checked, described contents',
    });
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    expect(returned.body).toMatchObject({ status: 'RETURNED' });
    expect(
      (await close(reception, { status: 'DISPOSED', note: 'again' }, returned.body.version)).status,
    ).toBe(409);
    expect((await hk.get(url)).body.items).toHaveLength(0);
    expect((await hk.get(`${url}?status=CLOSED`)).body.items).toHaveLength(1);
  });
});
