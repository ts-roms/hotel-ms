/**
 * A hotel day end to end (blueprint §12.4, §12.5, §15): check-in rules, folio postings with
 * inclusive VAT, voids, payments, night audit (room charges, no-shows, statistics, business
 * date), check-out rules, housekeeping and adjustments. MNL opens on 2026-10-01 with
 * STD ×4 at ₱3,500 and DLX ×2 at ₱5,500, VAT 12% inclusive.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient, withDbContext } from '@hotel/database';
import { testDatabaseUrls } from '@hotel/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let reception: TestClient;
let admin: TestClient;
let hk: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const inv = () => ctx.world.inventory.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
const idem = () => ({ 'idempotency-key': `test-${randomUUID()}` });

async function book(arrivalDate: string, departureDate: string, roomNumber?: string) {
  const res = await reception.request(
    'POST',
    `${base()}/reservations`,
    {
      source: 'WALK_IN',
      booker: { newGuest: { firstName: 'Ana', lastName: `Guest-${arrivalDate}` } },
      rooms: [
        {
          roomTypeId: inv().roomTypes.STD,
          ratePlanId: inv().ratePlans.BAR,
          arrivalDate,
          departureDate,
          adults: 2,
          ...(roomNumber ? { roomId: inv().rooms[roomNumber] } : {}),
        },
      ],
    },
    idem(),
  );
  expect(res.status).toBe(201);
  return { id: res.body.id as string, lineId: res.body.rooms[0].id as string };
}

const checkIn = (b: { id: string; lineId: string }) =>
  reception.request('POST', `${base()}/reservations/${b.id}/rooms/${b.lineId}/check-in`);
const checkOut = (b: { id: string; lineId: string }) =>
  reception.request('POST', `${base()}/reservations/${b.id}/rooms/${b.lineId}/check-out`);
const folioOf = async (b: { id: string; lineId: string }) =>
  (await reception.get(`${base()}/reservations/${b.id}/rooms/${b.lineId}/folio`)).body;

let stayA: { id: string; lineId: string };
let noShowB: { id: string; lineId: string };
let folioA: string;

beforeAll(async () => {
  ctx = await startTestApp();
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('check-in', () => {
  it('needs an assigned room and the arrival date', async () => {
    noShowB = await book('2026-10-01', '2026-10-02');
    const unassigned = await checkIn(noShowB);
    expect(unassigned.status).toBe(409);
    expect(unassigned.body.code).toBe('ROOM_NOT_READY');

    const future = await book('2026-10-05', '2026-10-06', '103');
    const early = await checkIn(future);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('INVALID_STATE');
  });

  it('refuses a room that is not clean', async () => {
    const dirty = await book('2026-10-01', '2026-10-02', '104');
    await admin.request('PUT', `${base()}/rooms/${inv().rooms['104']}/housekeeping-status`, {
      status: 'DIRTY',
    });
    const res = await checkIn(dirty);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROOM_NOT_READY');
    await reception.request('POST', `${base()}/reservations/${dirty.id}/cancel`, {
      reason: 'test cleanup',
    });
  });

  it('checks in, opens a folio and shows the guest in house', async () => {
    stayA = await book('2026-10-01', '2026-10-03', '101');
    const res = await checkIn(stayA);
    expect(res.status).toBe(200);
    expect(res.body.rooms[0].status).toBe('IN_HOUSE');

    const folio = await folioOf(stayA);
    folioA = folio.id;
    expect(folio).toMatchObject({ status: 'OPEN', balanceMinor: 0, currency: 'PHP' });
    expect(folio.folioNo).toMatch(/^MNL-F\d{6}$/);

    const board = await reception.get(`${base()}/front-desk`);
    expect(board.body.businessDate).toBe('2026-10-01');
    expect(
      board.body.inHouse.map((i: { reservationRoomId: string }) => i.reservationRoomId),
    ).toContain(stayA.lineId);
    expect(
      board.body.arrivals.map((i: { reservationRoomId: string }) => i.reservationRoomId),
    ).toContain(noShowB.lineId);

    expect((await checkIn(stayA)).status).toBe(409);
  });
});

describe('folio', () => {
  it('posts a charge as net + inclusive VAT, idempotently', async () => {
    const headers = idem();
    const body = { department: 'FNB', description: 'Dinner', amountMinor: 112_000 };
    const first = await reception.request(
      'POST',
      `${base()}/folios/${folioA}/charges`,
      body,
      headers,
    );
    const retry = await reception.request(
      'POST',
      `${base()}/folios/${folioA}/charges`,
      body,
      headers,
    );
    expect(first.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(first.body.balanceMinor).toBe(112_000);
    const lines = first.body.lines.map(
      (l: { type: string; amountMinor: number; taxCode: string | null }) => [
        l.type,
        l.amountMinor,
        l.taxCode,
      ],
    );
    expect(lines).toEqual([
      ['CHARGE', 100_000, null],
      ['TAX', 12_000, 'VAT'],
    ]);
    expect((await folioOf(stayA)).balanceMinor).toBe(112_000);
  });

  it('voids a same-day charge with reversal lines, once', async () => {
    const folio = await folioOf(stayA);
    const charge = folio.lines.find((l: { type: string }) => l.type === 'CHARGE');
    const voided = await reception.request(
      'POST',
      `${base()}/folios/${folioA}/lines/${charge.id}/void`,
      { reason: 'Wrong room' },
    );
    expect(voided.status).toBe(200);
    expect(voided.body.balanceMinor).toBe(0);
    expect(voided.body.lines.filter((l: { type: string }) => l.type === 'REVERSAL')).toHaveLength(
      2,
    );
    expect(voided.body.lines.find((l: { id: string }) => l.id === charge.id).reversed).toBe(true);
    expect(
      (
        await reception.request('POST', `${base()}/folios/${folioA}/lines/${charge.id}/void`, {
          reason: 'Again',
        })
      ).status,
    ).toBe(409);
  });

  it('records payments; refuses card numbers in the reference', async () => {
    await reception.request(
      'POST',
      `${base()}/folios/${folioA}/charges`,
      { department: 'MINIBAR', description: 'Water', amountMinor: 5_600 },
      idem(),
    );
    const pan = await reception.request(
      'POST',
      `${base()}/folios/${folioA}/payments`,
      { method: 'CARD', amountMinor: 5_600, reference: '4111 1111 1111 1111' },
      idem(),
    );
    expect(pan.status).toBe(400);
    // Cash goes into the cashier's shift (ADR-0016).
    const noShift = await reception.request(
      'POST',
      `${base()}/folios/${folioA}/payments`,
      { method: 'CASH', amountMinor: 5_600 },
      idem(),
    );
    expect(noShift.body.code).toBe('CASHIER_SHIFT_REQUIRED');
    expect(
      (await reception.request('POST', `${base()}/cashier/shift`, { openingFloatMinor: 500_000 }))
        .status,
    ).toBe(201);
    const paid = await reception.request(
      'POST',
      `${base()}/folios/${folioA}/payments`,
      { method: 'CASH', amountMinor: 5_600 },
      idem(),
    );
    expect(paid.body.balanceMinor).toBe(0);
    expect(paid.body.payments).toHaveLength(1);
  });
});

describe('night audit', () => {
  it('needs MFA and the night_audit.run permission', async () => {
    expect((await reception.get(`${base()}/night-audit`)).status).toBe(403);
    const noMfa = await TestClient.as(ctx.app, 'john.gm@abc.test');
    expect((await noMfa.get(`${base()}/night-audit`)).body.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('previews, then closes the day: room charge, no-show, stats, next business date', async () => {
    const preview = await admin.get(`${base()}/night-audit`);
    expect(preview.body).toMatchObject({
      businessDate: '2026-10-01',
      canRun: true,
      inHouseCount: 1,
    });
    expect(
      preview.body.expectedNoShows.map((i: { reservationRoomId: string }) => i.reservationRoomId),
    ).toContain(noShowB.lineId);

    const run = await admin.request('POST', `${base()}/night-audit`, {
      businessDate: '2026-10-01',
    });
    expect(run.status).toBe(200);
    expect(run.body.nextBusinessDate).toBe('2026-10-02');
    expect(run.body.stats).toEqual({
      currency: 'PHP',
      roomsAvailable: 6,
      roomsSold: 1,
      occupancyPct: 16.7,
      roomRevenueMinor: 312_500,
      adrMinor: 312_500,
      revparMinor: 52_083,
      arrivals: 1,
      departures: 0,
      noShows: 1,
    });

    // Tonight's room charge: ₱3,500 = ₱3,125 net + ₱375 VAT.
    const folio = await folioOf(stayA);
    expect(folio.balanceMinor).toBe(350_000);
    expect(
      folio.lines
        .filter((l: { department: string }) => l.department === 'ROOM')
        .map((l: { amountMinor: number }) => l.amountMinor),
    ).toEqual([312_500, 37_500]);

    const b = await reception.get(`${base()}/reservations/${noShowB.id}`);
    expect(b.body.rooms[0].status).toBe('NO_SHOW');

    // Running the same day again is refused; the charge is not posted twice.
    const again = await admin.request('POST', `${base()}/night-audit`, {
      businessDate: '2026-10-01',
    });
    expect(again.status).toBe(409);
    expect((await folioOf(stayA)).balanceMinor).toBe(350_000);

    // The stayover room was dirtied for tomorrow.
    const rooms = await reception.get(`${base()}/rooms`);
    expect(rooms.body.find((r: { number: string }) => r.number === '101').housekeepingStatus).toBe(
      'DIRTY',
    );
  });
});

describe('check-out', () => {
  it('requires a settled folio, closes it, frees unused nights and dirties the room', async () => {
    const owing = await checkOut(stayA);
    expect(owing.status).toBe(409);
    expect(owing.body.code).toBe('BALANCE_OUTSTANDING');

    await reception.request(
      'POST',
      `${base()}/folios/${folioA}/payments`,
      { method: 'CARD', amountMinor: 350_000, reference: 'POS-12345' },
      idem(),
    );
    const out = await checkOut(stayA);
    expect(out.status).toBe(200);
    expect(out.body.rooms[0].status).toBe('CHECKED_OUT');
    // Left a night early: departure moves to today and the unused night is released.
    expect(out.body.rooms[0].departureDate).toBe('2026-10-02');
    const availability = await reception.get(
      `${base()}/availability?from=2026-10-02&to=2026-10-03`,
    );
    expect(
      availability.body.roomTypes.find((r: { code: string }) => r.code === 'STD').nights[0].sold,
    ).toBe(0);

    const folio = await folioOf(stayA);
    expect(folio.status).toBe('CLOSED');
    const closedPost = await reception.request(
      'POST',
      `${base()}/folios/${folioA}/charges`,
      { department: 'MISC', description: 'Late', amountMinor: 100 },
      idem(),
    );
    expect(closedPost.status).toBe(409);
  });
});

describe('housekeeping', () => {
  it('housekeepers see and work only rooms assigned to them; inspection needs a supervisor', async () => {
    const board = await hk.get(`${base()}/housekeeping`);
    expect(board.body).toMatchObject({ fullBoard: false, rooms: [] });

    const full = await admin.get(`${base()}/housekeeping`);
    const room101 = full.body.rooms.find((r: { number: string }) => r.number === '101');
    expect(room101.openTask.type).toBe('CHECKOUT_CLEAN');

    const members = await admin.get('/api/v1/members');
    const hkMembership = members.body.find(
      (m: { email: string }) => m.email === 'hk@abc.test',
    ).membershipId;
    expect(
      (
        await admin.request('PUT', `${base()}/housekeeping/tasks/${room101.openTask.id}/assignee`, {
          assignedMembershipId: hkMembership,
        })
      ).status,
    ).toBe(200);

    const mine = await hk.get(`${base()}/housekeeping`);
    expect(mine.body.rooms.map((r: { number: string }) => r.number)).toEqual(['101']);

    const url = `${base()}/rooms/${inv().rooms['101']}/housekeeping-status`;
    expect((await hk.request('PUT', url, { status: 'CLEANING' })).body.openTask.status).toBe(
      'IN_PROGRESS',
    );
    const clean = await hk.request('PUT', url, { status: 'CLEAN' });
    expect(clean.body).toMatchObject({ housekeepingStatus: 'CLEAN', openTask: null });

    expect((await hk.request('PUT', url, { status: 'INSPECTED' })).status).toBe(403);
    expect(
      (
        await hk.request('PUT', `${base()}/rooms/${inv().rooms['102']}/housekeeping-status`, {
          status: 'DIRTY',
        })
      ).status,
    ).toBe(403);
    expect((await admin.request('PUT', url, { status: 'INSPECTED' })).body.housekeepingStatus).toBe(
      'INSPECTED',
    );

    const invalid = await admin.request('PUT', url, { status: 'CLEANING' });
    expect(invalid.status).toBe(409);
  });
});

describe('closed days and adjustments', () => {
  it('charges from a closed day cannot be voided; adjustments need MFA and permission', async () => {
    const stay = await book('2026-10-02', '2026-10-04', '102');
    expect((await checkIn(stay)).status).toBe(200);
    const folio = await folioOf(stay);
    await reception.request(
      'POST',
      `${base()}/folios/${folio.id}/charges`,
      { department: 'LAUNDRY', description: 'Shirts', amountMinor: 22_400 },
      idem(),
    );

    expect(
      (await admin.request('POST', `${base()}/night-audit`, { businessDate: '2026-10-02' })).status,
    ).toBe(200);

    const after = await folioOf(stay);
    const laundry = after.lines.find(
      (l: { department: string; type: string }) =>
        l.department === 'LAUNDRY' && l.type === 'CHARGE',
    );
    const lateVoid = await reception.request(
      'POST',
      `${base()}/folios/${folio.id}/lines/${laundry.id}/void`,
      { reason: 'Complaint' },
    );
    expect(lateVoid.status).toBe(409);

    const adjustment = {
      department: 'LAUNDRY',
      description: 'Goodwill credit',
      amountMinor: -22_400,
      reason: 'Complaint',
    };
    expect(
      (
        await reception.request(
          'POST',
          `${base()}/folios/${folio.id}/adjustments`,
          adjustment,
          idem(),
        )
      ).status,
    ).toBe(403);
    const credited = await admin.request(
      'POST',
      `${base()}/folios/${folio.id}/adjustments`,
      adjustment,
      idem(),
    );
    expect(credited.status).toBe(200);
    expect(credited.body.balanceMinor).toBe(after.balanceMinor - 22_400);
  });

  it('every folio balance equals the sum of its lines, and lines cannot be edited', async () => {
    const app = createPrismaClient({ connectionString: testDatabaseUrls().app, maxConnections: 1 });
    try {
      const org = { organizationId: ctx.world.abc.organizationId, identityId: null };
      const mismatches = await withDbContext(
        app,
        org,
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`
          SELECT f.id FROM folios f
          LEFT JOIN folio_lines l ON l.folio_id = f.id
          GROUP BY f.id, f.balance_minor
          HAVING f.balance_minor <> COALESCE(SUM(l.amount_minor), 0)`,
      );
      expect(mismatches).toEqual([]);
      await expect(
        withDbContext(app, org, (tx) => tx.folioLine.updateMany({ data: { description: 'x' } })),
      ).rejects.toThrow(/permission denied/);
      await expect(withDbContext(app, org, (tx) => tx.folioLine.deleteMany())).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await app.$disconnect();
    }
  });

  it('closed days keep their statistics', async () => {
    const res = await reception.get(`${base()}/business-days`);
    expect(res.body.map((d: { businessDate: string }) => d.businessDate)).toEqual([
      '2026-10-02',
      '2026-10-01',
    ]);
  });
});
