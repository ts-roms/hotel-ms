/**
 * Inventory and pricing set-up (pms/inventory, pms/pricing): buildings and floors, room
 * types with their defaults, rooms and archiving them, rate plans with their price lists,
 * and quotes from them. MNL opens on 2026-10-01.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let reception: TestClient;
let hk: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
const idem = () => ({ 'idempotency-key': `test-${randomUUID()}` });
const ifMatch = (version: number) => ({ 'if-match': `W/"${version}"` });

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('inventory and pricing set-up', () => {
  let floorId: string;
  let roomTypeId: string;
  let roomId: string;
  let ratePlanId: string;

  it('buildings carry their floors; codes are unique per property', async () => {
    const url = `${base()}/buildings`;
    const body = {
      code: 'ANNEX',
      name: 'Garden Annex',
      floors: [
        { level: 1, name: 'Ground' },
        { level: 2, name: 'Second' },
      ],
    };
    expect((await hk.request('POST', url, body)).status).toBe(403);
    const created = await admin.request('POST', url, body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.floors.map((f: { level: number }) => f.level)).toEqual([1, 2]);
    floorId = created.body.floors[0].id;
    expect((await admin.request('POST', url, body)).status).toBe(409);
    // Floors are optional.
    const bare = await admin.request('POST', url, { code: 'KIOSK', name: 'Pool kiosk' });
    expect(bare.status, JSON.stringify(bare.body)).toBe(201);
    expect(bare.body.floors).toEqual([]);
    const list = await reception.get(url);
    expect(list.status).toBe(200);
    expect(list.body.map((b: { code: string }) => b.code)).toEqual(
      expect.arrayContaining(['ANNEX', 'KIOSK']),
    );
  });

  it('room types fill in their defaults and are edited with If-Match', async () => {
    const url = `${base()}/room-types`;
    expect(
      (
        await admin.request('POST', url, {
          code: 'BAD',
          name: 'Too small',
          baseOccupancy: 3,
          maxOccupancy: 2,
        })
      ).status,
    ).toBe(400);
    const created = await admin.request('POST', url, {
      code: 'GST',
      name: 'Garden Studio',
      baseOccupancy: 2,
      maxOccupancy: 3,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      description: '',
      sortOrder: 0,
      archived: false,
      roomCount: 0,
    });
    roomTypeId = created.body.id;
    expect(
      (
        await admin.request('POST', url, {
          code: 'GST',
          name: 'Again',
          baseOccupancy: 1,
          maxOccupancy: 1,
        })
      ).status,
    ).toBe(409);

    const patch = `${url}/${roomTypeId}`;
    expect((await admin.request('PATCH', patch, { name: 'No version' })).status).toBe(428);
    const renamed = await admin.request(
      'PATCH',
      patch,
      { name: 'Garden Studio King' },
      ifMatch(created.body.version),
    );
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.headers.etag).toBe(`W/"${renamed.body.version}"`);
    expect(
      (await admin.request('PATCH', patch, { name: 'Stale' }, ifMatch(created.body.version)))
        .status,
    ).toBe(412);
  });

  it('rooms are created on a floor and archived out of the room count', async () => {
    const created = await admin.request('POST', `${base()}/rooms`, {
      number: 'G01',
      roomTypeId,
      floorId,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ floorId, notes: '', archived: false });
    roomId = created.body.id;
    const count = async () =>
      (await reception.get(`${base()}/room-types`)).body.find(
        (t: { id: string }) => t.id === roomTypeId,
      ).roomCount as number;
    expect(await count()).toBe(1);

    const archive = () => admin.request('POST', `${base()}/rooms/${roomId}/archive`);
    expect((await hk.request('POST', `${base()}/rooms/${roomId}/archive`)).status).toBe(403);
    const archived = await archive();
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(archived.body.archived).toBe(true);
    expect(await count()).toBe(0);
    // Archiving again changes nothing.
    expect((await archive()).status).toBe(200);
    // An archived room takes no new status changes.
    expect(
      (
        await admin.request('PUT', `${base()}/rooms/${roomId}/service-status`, {
          status: 'OUT_OF_SERVICE',
        })
      ).status,
    ).toBe(404);
  });

  it('a room held for a future stay cannot be archived', async () => {
    const room = await admin.request('POST', `${base()}/rooms`, { number: 'G02', roomTypeId });
    expect(room.status, JSON.stringify(room.body)).toBe(201);
    const plan = await admin.request('POST', `${base()}/rate-plans`, {
      code: 'GARDEN',
      name: 'Garden rate',
      prices: [{ roomTypeId, baseAmountMinor: 420_000 }],
    });
    expect(plan.status, JSON.stringify(plan.body)).toBe(201);
    ratePlanId = plan.body.id;
    const booking = await reception.request(
      'POST',
      `${base()}/reservations`,
      {
        source: 'DIRECT',
        booker: { newGuest: { firstName: 'Gus', lastName: 'Garden', email: null } },
        rooms: [
          {
            roomTypeId,
            ratePlanId,
            arrivalDate: '2026-11-10',
            departureDate: '2026-11-12',
            adults: 1,
            roomId: room.body.id,
          },
        ],
      },
      idem(),
    );
    expect(booking.status, JSON.stringify(booking.body)).toBe(201);
    const archive = await admin.request('POST', `${base()}/rooms/${room.body.id}/archive`);
    expect(archive.status).toBe(409);
  });

  it('rate plans price room types; the price list is replaced with If-Match', async () => {
    const url = `${base()}/rate-plans`;
    expect((await admin.request('POST', url, { code: 'GARDEN', name: 'Duplicate' })).status).toBe(
      409,
    );
    expect((await reception.request('POST', url, { code: 'NOPE', name: 'x' })).status).toBe(403);
    const quote = async () =>
      (
        await reception.get(
          `${base()}/quote?roomTypeId=${roomTypeId}&ratePlanId=${ratePlanId}&arrivalDate=2026-11-20&departureDate=2026-11-22`,
        )
      ).body;
    expect((await quote()).totalMinor).toBe(840_000);

    const plan = (await reception.get(url)).body.find((p: { id: string }) => p.id === ratePlanId);
    expect(plan).toMatchObject({ archived: false, description: '', cancellationPolicy: '' });
    const updated = await admin.request(
      'PATCH',
      `${url}/${ratePlanId}`,
      { prices: [{ roomTypeId, baseAmountMinor: 500_000 }] },
      ifMatch(plan.version),
    );
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.prices).toEqual([{ roomTypeId, baseAmountMinor: 500_000 }]);
    expect((await quote()).totalMinor).toBe(1_000_000);
    expect(
      (
        await admin.request(
          'PATCH',
          `${url}/${ratePlanId}`,
          { name: 'Stale' },
          ifMatch(plan.version),
        )
      ).status,
    ).toBe(412);
  });
});
