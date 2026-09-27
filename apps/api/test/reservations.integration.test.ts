/**
 * PMS core: inventory, pricing, reservations, room assignment (blueprint §12). The demo
 * properties start on business date 2026-10-01. MNL has STD ×4 (₱3,500) and DLX ×2 (₱5,500).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let reception: TestClient;
let john: TestClient;
let xyzAdmin: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const inv = () => ctx.world.inventory.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
const key = () => `test-${randomUUID()}`;

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.as(ctx.app, 'admin@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  john = await TestClient.as(ctx.app, 'john.gm@abc.test');
  xyzAdmin = await TestClient.as(ctx.app, 'admin@xyz.test');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

function booking(overrides: Record<string, unknown> = {}, room: Record<string, unknown> = {}) {
  return {
    source: 'PHONE',
    booker: { newGuest: { firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@example.test' } },
    rooms: [
      {
        roomTypeId: inv().roomTypes.STD,
        ratePlanId: inv().ratePlans.BAR,
        arrivalDate: '2026-10-05',
        departureDate: '2026-10-07',
        adults: 2,
        ...room,
      },
    ],
    ...overrides,
  };
}

const book = (client: TestClient, body: unknown, idempotencyKey = key()) =>
  client.request('POST', `${base()}/reservations`, body, { 'idempotency-key': idempotencyKey });

async function availability(from: string, to: string, code: 'STD' | 'DLX') {
  const res = await reception.get(`${base()}/availability?from=${from}&to=${to}`);
  return res.body.roomTypes.find((rt: { code: string }) => rt.code === code).nights;
}

describe('availability and pricing', () => {
  it('shows full capacity when nothing is sold', async () => {
    const nights = await availability('2026-10-01', '2026-10-04', 'DLX');
    expect(nights).toEqual([
      { date: '2026-10-01', capacity: 2, sold: 0, blocked: 0, available: 2 },
      { date: '2026-10-02', capacity: 2, sold: 0, blocked: 0, available: 2 },
      { date: '2026-10-03', capacity: 2, sold: 0, blocked: 0, available: 2 },
    ]);
  });

  it('quotes nightly prices, using overrides where set', async () => {
    const overrides = await admin.request(
      'PUT',
      `${base()}/rate-plans/${inv().ratePlans.BAR}/overrides`,
      {
        roomTypeId: inv().roomTypes.STD,
        from: '2026-12-24',
        to: '2026-12-26',
        amountMinor: 600000,
      },
    );
    expect(overrides.status).toBe(204);
    const quote = await reception.get(
      `${base()}/quote?roomTypeId=${inv().roomTypes.STD}&ratePlanId=${inv().ratePlans.BAR}&arrivalDate=2026-12-23&departureDate=2026-12-26`,
    );
    expect(quote.body).toEqual({
      currency: 'PHP',
      nights: [
        { date: '2026-12-23', amountMinor: 350000 },
        { date: '2026-12-24', amountMinor: 600000 },
        { date: '2026-12-25', amountMinor: 600000 },
      ],
      totalMinor: 1550000,
    });
  });
});

describe('creating reservations', () => {
  it('requires an Idempotency-Key', async () => {
    const res = await reception.request('POST', `${base()}/reservations`, booking());
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.errors)).toContain('Idempotency-Key');
  });

  it('books, numbers, prices and takes inventory', async () => {
    const res = await book(reception, booking());
    expect(res.status).toBe(201);
    expect(res.body.confirmationNo).toMatch(/^MNL-\d{6}$/);
    expect(res.body.totalMinor).toBe(700000);
    expect(res.body.rooms[0].nights).toEqual([
      { date: '2026-10-05', amountMinor: 350000 },
      { date: '2026-10-06', amountMinor: 350000 },
    ]);
    expect(res.body.booker).toMatchObject({ firstName: 'Juan', lastName: 'Dela Cruz' });
    const nights = await availability('2026-10-05', '2026-10-07', 'STD');
    expect(nights.map((n: { sold: number }) => n.sold)).toEqual([1, 1]);
  });

  it('replays a retried request instead of booking twice; rejects key reuse with another body', async () => {
    const k = key();
    const first = await book(
      reception,
      booking({}, { arrivalDate: '2026-10-10', departureDate: '2026-10-11' }),
      k,
    );
    const retry = await book(
      reception,
      booking({}, { arrivalDate: '2026-10-10', departureDate: '2026-10-11' }),
      k,
    );
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.id).toBe(first.body.id);
    expect((await availability('2026-10-10', '2026-10-11', 'STD'))[0].sold).toBe(1);

    const reused = await book(
      reception,
      booking({}, { arrivalDate: '2026-10-12', departureDate: '2026-10-13' }),
      k,
    );
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('never oversells under concurrent bookings', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        book(
          reception,
          booking(
            {},
            {
              roomTypeId: inv().roomTypes.DLX,
              arrivalDate: '2026-10-20',
              departureDate: '2026-10-21',
            },
          ),
        ),
      ),
    );
    const statuses = attempts.map((a) => a.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    expect(attempts.find((a) => a.status === 409)!.body.code).toBe('NO_AVAILABILITY');
    expect(await availability('2026-10-20', '2026-10-21', 'DLX')).toEqual([
      { date: '2026-10-20', capacity: 2, sold: 2, blocked: 0, available: 0 },
    ]);
  });

  it('validates dates, occupancy and property ownership of rate plans', async () => {
    const past = await book(
      reception,
      booking({}, { arrivalDate: '2026-09-30', departureDate: '2026-10-02' }),
    );
    expect(past.status).toBe(400);
    const crowded = await book(reception, booking({}, { adults: 4 }));
    expect(crowded.status).toBe(400);
    const foreignPlan = await book(
      reception,
      booking({}, { ratePlanId: ctx.world.inventory.CEB.ratePlans.BAR }),
    );
    expect(foreignPlan.status).toBe(400);
    const foreignType = await book(
      reception,
      booking({}, { roomTypeId: ctx.world.inventory.BOR.roomTypes.VIL }),
    );
    expect(foreignType.status).toBe(400);
  });
});

describe('room assignment and blocks', () => {
  it('assigns a room; the same room cannot be held twice for overlapping nights', async () => {
    const a = await book(
      reception,
      booking({}, { arrivalDate: '2026-11-01', departureDate: '2026-11-04' }),
    );
    const b = await book(
      reception,
      booking({}, { arrivalDate: '2026-11-03', departureDate: '2026-11-05' }),
    );
    const room101 = inv().rooms['101'];

    const first = await reception.request(
      'PUT',
      `${base()}/reservations/${a.body.id}/rooms/${a.body.rooms[0].id}/assignment`,
      { roomId: room101 },
    );
    expect(first.status).toBe(200);
    expect(first.body.rooms[0].assignedRoom).toEqual({ roomId: room101, number: '101' });

    const clash = await reception.request(
      'PUT',
      `${base()}/reservations/${b.body.id}/rooms/${b.body.rooms[0].id}/assignment`,
      { roomId: room101 },
    );
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('ROOM_UNAVAILABLE');

    const wrongType = await reception.request(
      'PUT',
      `${base()}/reservations/${b.body.id}/rooms/${b.body.rooms[0].id}/assignment`,
      {
        roomId: inv().rooms['201'],
      },
    );
    expect(wrongType.status).toBe(400);
  });

  it('out-of-order blocks take the room off sale and cannot overlap bookings', async () => {
    const room = inv().rooms['104'];
    const block = await admin.request('POST', `${base()}/rooms/${room}/blocks`, {
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      reason: 'Bathroom repair',
    });
    expect(block.status).toBe(201);
    expect(
      (await availability('2026-11-10', '2026-11-12', 'STD')).map(
        (n: { blocked: number }) => n.blocked,
      ),
    ).toEqual([1, 1]);

    const stay = await book(
      reception,
      booking({}, { arrivalDate: '2026-11-11', departureDate: '2026-11-13' }),
    );
    const assign = await reception.request(
      'PUT',
      `${base()}/reservations/${stay.body.id}/rooms/${stay.body.rooms[0].id}/assignment`,
      { roomId: room },
    );
    expect(assign.status).toBe(409);

    // A block over an assigned booking is refused too.
    await reception.request(
      'PUT',
      `${base()}/reservations/${stay.body.id}/rooms/${stay.body.rooms[0].id}/assignment`,
      { roomId: inv().rooms['103'] },
    );
    const overBooking = await admin.request(
      'POST',
      `${base()}/rooms/${inv().rooms['103']}/blocks`,
      {
        startDate: '2026-11-12',
        endDate: '2026-11-14',
        reason: 'Paint',
      },
    );
    expect(overBooking.status).toBe(409);

    expect(
      (await admin.request('DELETE', `${base()}/rooms/${room}/blocks/${block.body.id}`)).status,
    ).toBe(204);
    expect(
      (await availability('2026-11-10', '2026-11-12', 'STD')).map(
        (n: { blocked: number }) => n.blocked,
      ),
    ).toEqual([0, 0]);
  });

  it('front desk cannot configure rooms', async () => {
    const res = await reception.request('POST', `${base()}/rooms`, {
      number: '999',
      roomTypeId: inv().roomTypes.STD,
    });
    expect(res.status).toBe(403);
  });

  it('adding a room raises capacity of already-tracked nights', async () => {
    expect((await availability('2026-10-05', '2026-10-06', 'STD'))[0].capacity).toBe(4);
    const created = await admin.request('POST', `${base()}/rooms`, {
      number: '105',
      roomTypeId: inv().roomTypes.STD,
    });
    expect(created.status).toBe(201);
    expect((await availability('2026-10-05', '2026-10-06', 'STD'))[0].capacity).toBe(5);
  });
});

describe('modifying and cancelling', () => {
  it('extends a stay: inventory moves, nights are re-priced, the room assignment is kept', async () => {
    const res = await book(
      reception,
      booking(
        {},
        { arrivalDate: '2026-12-01', departureDate: '2026-12-03', roomId: inv().rooms['102'] },
      ),
    );
    const line = res.body.rooms[0];
    expect(line.assignedRoom.number).toBe('102');

    const url = `${base()}/reservations/${res.body.id}/rooms/${line.id}`;
    expect((await reception.request('PATCH', url, { departureDate: '2026-12-04' })).status).toBe(
      428,
    );
    const extended = await reception.request(
      'PATCH',
      url,
      { departureDate: '2026-12-04' },
      { 'if-match': `W/"${line.version}"` },
    );
    expect(extended.status).toBe(200);
    expect(extended.body.rooms[0].nights).toHaveLength(3);
    expect(extended.body.totalMinor).toBe(1050000);
    expect(extended.body.rooms[0].assignedRoom.number).toBe('102');
    expect((await availability('2026-12-03', '2026-12-04', 'STD'))[0].sold).toBe(1);

    const stale = await reception.request(
      'PATCH',
      url,
      { adults: 1 },
      { 'if-match': `W/"${line.version}"` },
    );
    expect(stale.status).toBe(412);
  });

  it('cancelling releases inventory and the room; a cancelled booking cannot be changed', async () => {
    const res = await book(
      reception,
      booking(
        {},
        { arrivalDate: '2027-01-05', departureDate: '2027-01-06', roomId: inv().rooms['101'] },
      ),
    );
    const cancelled = await reception.request(
      'POST',
      `${base()}/reservations/${res.body.id}/cancel`,
      { reason: 'Guest request' },
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.rooms[0].status).toBe('CANCELLED');
    expect(cancelled.body.rooms[0].assignedRoom).toBeNull();
    expect((await availability('2027-01-05', '2027-01-06', 'STD'))[0].sold).toBe(0);

    const again = await reception.request('POST', `${base()}/reservations/${res.body.id}/cancel`, {
      reason: 'Again',
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('INVALID_STATE');

    // The freed room can be booked again.
    const rebook = await book(
      reception,
      booking(
        {},
        { arrivalDate: '2027-01-05', departureDate: '2027-01-06', roomId: inv().rooms['101'] },
      ),
    );
    expect(rebook.status).toBe(201);
  });

  it('every change is audited', async () => {
    const mfaAdmin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
    const res = await mfaAdmin.get(`/api/v1/audit-logs?entityType=reservation&limit=100`);
    const actions = new Set(res.body.items.map((e: { action: string }) => e.action));
    for (const action of [
      'reservation.created',
      'reservation.room_assigned',
      'reservation.modified',
      'reservation.cancelled',
    ]) {
      expect(actions).toContain(action);
    }
  });
});

describe('guests and scope', () => {
  it('lists and searches reservations', async () => {
    const res = await reception.get(`${base()}/reservations?q=dela&limit=5`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(5);
    expect(res.body.nextCursor).not.toBeNull();
  });

  it('guest profiles are visible only within scope', async () => {
    const mine = await reception.get('/api/v1/guests?q=juan');
    expect(mine.body.length).toBeGreaterThan(0);
    const maria = await TestClient.as(ctx.app, 'maria.hr@abc.test'); // auditor at MNL + CEB
    expect((await maria.get('/api/v1/guests?q=juan')).body.length).toBeGreaterThan(0);
    expect((await xyzAdmin.get('/api/v1/guests?q=juan')).body).toEqual([]);
    const staffOnly = await TestClient.as(ctx.app, 'frontdesk@abc.test'); // CEB staff, no guest.read
    expect((await staffOnly.get('/api/v1/guests?q=juan')).status).toBe(403);
  });

  it("a GM of one property cannot see another property's bookings or availability", async () => {
    const ceb = `/api/v1/properties/${ctx.world.abc.properties.CEB}`;
    expect((await john.get(`${ceb}/availability?from=2026-10-01&to=2026-10-02`)).status).toBe(404);
    expect((await john.get(`${ceb}/reservations`)).status).toBe(404);
  });
});
