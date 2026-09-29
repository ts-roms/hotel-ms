/**
 * Guest portal (blueprint §11, spec §23–26): link → guest session, the guest realm's
 * separation from staff, email verification, pre-check-in, self check-in on the front
 * desk's rules, the bill, and service requests end to end. MNL opens on 2026-10-01.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient, withDbContext } from '@hotel/database';
import { testDatabaseUrls } from '@hotel/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GuestClient, Mailbox, startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let reception: TestClient;
let admin: TestClient;
let hk: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const inv = () => ctx.world.inventory.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
/** A fresh future night per call, so tests never compete for inventory. */
let nextNight = 0;
function later(): [string, string] {
  const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n)).toISOString().slice(0, 10);
  const n = nextNight++;
  return [day(n), day(n + 1)];
}
const idem = () => ({ 'idempotency-key': `test-${randomUUID()}` });

async function book(
  arrivalDate: string,
  departureDate: string,
  email: string | null,
  roomType = 'DLX',
) {
  const res = await reception.request(
    'POST',
    `${base()}/reservations`,
    {
      source: 'DIRECT',
      booker: {
        newGuest: { firstName: 'Gia', lastName: `Guest-${randomUUID().slice(0, 6)}`, email },
      },
      rooms: [
        {
          roomTypeId: inv().roomTypes[roomType],
          ratePlanId: inv().ratePlans.BAR,
          arrivalDate,
          departureDate,
          adults: 2,
        },
      ],
    },
    idem(),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id as string, lineId: res.body.rooms[0].id as string };
}

const sendLink = (reservationId: string, client = reception) =>
  client.request('POST', `${base()}/reservations/${reservationId}/guest-portal-link`);

async function linkToken(email: string): Promise<string> {
  const mail = await ctx.mailbox.latestFor(email, 'guest-portal-link');
  expect(mail).toBeDefined();
  return Mailbox.tokenFrom((mail!.data as { portalUrl: string }).portalUrl);
}

/** Books, sends the link, and opens a guest session. */
async function guestFor(arrivalDate: string, departureDate: string) {
  const email = `guest-${randomUUID().slice(0, 8)}@example.test`;
  const booking = await book(arrivalDate, departureDate, email);
  expect((await sendLink(booking.id)).status).toBe(204);
  const guest = new GuestClient(ctx.app);
  const res = await guest.request('POST', '/guest/session', { token: await linkToken(email) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { guest, booking, email, stay: res.body };
}

async function verify(guest: GuestClient, email: string) {
  expect((await guest.request('POST', '/guest/verification')).status).toBe(204);
  const mail = await ctx.mailbox.latestFor(email, 'guest-verification-code');
  const code = (mail!.data as { code: string }).code;
  const res = await guest.request('POST', '/guest/verification/confirm', { code });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function setCheckInTime(checkInTime: string) {
  const current = await admin.get(`/api/v1/properties/${MNL()}`);
  const res = await admin.request(
    'PATCH',
    `/api/v1/properties/${MNL()}`,
    { checkInTime },
    { 'if-match': String(current.headers.etag) },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

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

describe('portal link', () => {
  it('is emailed to the booker; a new link revokes the previous one and its sessions', async () => {
    const email = `link-${randomUUID().slice(0, 8)}@example.test`;
    const booking = await book(...later(), email);
    expect((await sendLink(booking.id)).status).toBe(204);
    const mail = await ctx.mailbox.latestFor(email, 'guest-portal-link');
    expect((mail!.data as { portalUrl: string }).portalUrl).toMatch(
      /^http:\/\/localhost:43200\/welcome#token=/,
    );
    const first = await linkToken(email);
    const early = new GuestClient(ctx.app);
    expect((await early.request('POST', '/guest/session', { token: first })).status).toBe(200);

    expect((await sendLink(booking.id)).status).toBe(204);
    // Whoever opened the old link (e.g. it went to the wrong person) is signed out.
    expect((await early.request('GET', '/guest/stay')).status).toBe(401);
    const second = await linkToken(email);
    expect(second).not.toBe(first);

    expect(
      (await new GuestClient(ctx.app).request('POST', '/guest/session', { token: first })).status,
    ).toBe(400);
    expect(
      (await new GuestClient(ctx.app).request('POST', '/guest/session', { token: second })).status,
    ).toBe(200);
  });

  it('needs a booker email, the permission, and a live booking', async () => {
    const noEmail = await book(...later(), null);
    expect((await sendLink(noEmail.id)).status).toBe(400);
    expect((await sendLink(noEmail.id, hk)).status).toBe(403);

    const cancelled = await book(...later(), 'cancel-me@example.test');
    const cancel = await reception.request(
      'POST',
      `${base()}/reservations/${cancelled.id}/cancel`,
      { reason: 'Test' },
      idem(),
    );
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect((await sendLink(cancelled.id)).status).toBe(409);
  });

  it('rejects unknown and malformed tokens', async () => {
    const guest = new GuestClient(ctx.app);
    expect((await guest.request('POST', '/guest/session', { token: 'A'.repeat(43) })).status).toBe(
      400,
    );
    expect((await guest.request('POST', '/guest/session', { token: 'short' })).status).toBe(400);
  });
});

describe('guest realm', () => {
  it('a guest session shows only its own booking, without the room number before arrival', async () => {
    const { stay } = await guestFor(...later());
    expect(stay.property.name).toBe('ABC Hotel Manila');
    expect(stay.stay.roomTypeName).toBe('Deluxe King');
    expect(stay.stay.roomNumber).toBeNull();
    expect(stay.verified).toBe(false);
    expect(stay.verificationDestination).toMatch(/^g•••@example\.test$/);
    expect(stay.selfCheckInAvailable).toBe(false);
  });

  it('guest and staff sessions are not interchangeable', async () => {
    const { guest } = await guestFor(...later());
    // The guest cookie means nothing to staff routes...
    expect((await guest.request('GET', '/properties')).status).toBe(401);
    expect((await guest.request('GET', `/properties/${MNL()}/front-desk`)).status).toBe(401);
    // ...and a staff session means nothing to guest routes.
    expect((await reception.get('/api/v1/guest/stay')).status).toBe(401);
    expect((await new GuestClient(ctx.app).request('GET', '/guest/stay')).status).toBe(401);
  });

  it('unsafe guest requests need the CSRF token and an allowed Origin', async () => {
    const { guest, email } = await guestFor(...later());
    await verify(guest, email);
    const body = { expectedArrivalTime: '15:00' };
    expect(
      (await guest.request('PUT', '/guest/pre-check-in', body, { 'x-csrf-token': 'nope' })).status,
    ).toBe(403);
    expect(
      (await guest.request('PUT', '/guest/pre-check-in', body, { origin: 'https://evil.test' }))
        .status,
    ).toBe(403);
    expect((await guest.request('PUT', '/guest/pre-check-in', body)).status).toBe(200);
  });

  it('logout ends the session', async () => {
    const { guest } = await guestFor(...later());
    const cookie = guest.rawCookie!;
    expect((await guest.request('DELETE', '/guest/session')).status).toBe(204);
    const replay = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/guest/stay',
      headers: { cookie },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('guest sessions are invisible without their token (RLS)', async () => {
    await guestFor(...later());
    const app = createPrismaClient({ connectionString: testDatabaseUrls().app, maxConnections: 1 });
    try {
      const none = { organizationId: null, identityId: null };
      expect(await withDbContext(app, none, (tx) => tx.guestSession.count())).toBe(0);
      expect(await withDbContext(app, none, (tx) => tx.guestPortalLink.count())).toBe(0);
      const xyz = { organizationId: ctx.world.xyz.organizationId, identityId: null };
      expect(await withDbContext(app, xyz, (tx) => tx.guestSession.count())).toBe(0);
      const abc = { organizationId: ctx.world.abc.organizationId, identityId: null };
      expect(await withDbContext(app, abc, (tx) => tx.guestSession.count())).toBeGreaterThan(0);
      // A wrong hash finds nothing even in the lookup context.
      const wrong = { organizationId: null, identityId: null, guestSessionHash: 'f'.repeat(64) };
      expect(await withDbContext(app, wrong, (tx) => tx.guestSession.count())).toBe(0);
    } finally {
      await app.$disconnect();
    }
  });
});

describe('pre-check-in', () => {
  it('records the arrival time, phone and requests on the booking', async () => {
    const { guest, booking, email } = await guestFor(...later());
    await verify(guest, email);
    const res = await guest.request('PUT', '/guest/pre-check-in', {
      expectedArrivalTime: '16:30',
      phone: '+63 917 555 0101',
      specialRequests: 'High floor please',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.stay.preCheckInCompleted).toBe(true);
    expect(res.body.stay.expectedArrivalTime).toBe('16:30');

    const staffView = await reception.get(`${base()}/reservations/${booking.id}`);
    expect(staffView.body.specialRequests).toContain('Guest: High floor please');
    const profile = await reception.get(`/api/v1/guests/${staffView.body.booker.id}`);
    expect(profile.body.phone).toBe('+63 917 555 0101');

    expect(
      (await guest.request('PUT', '/guest/pre-check-in', { expectedArrivalTime: '25:00' })).status,
    ).toBe(400);
  });
});

describe('verification', () => {
  it('is required for check-in, the bill and service requests, and codes work once', async () => {
    const { guest, email } = await guestFor(...later());
    for (const [method, url] of [
      ['POST', '/guest/check-in'],
      ['GET', '/guest/bill'],
      ['GET', '/guest/service-requests'],
      // A forwarded link alone must not change the guest's details or read staff messages.
      ['PUT', '/guest/pre-check-in'],
      ['GET', '/guest/notifications'],
    ] as const) {
      const res = await guest.request(method, url);
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(res.body.code).toBe('GUEST_VERIFICATION_REQUIRED');
    }

    expect((await guest.request('POST', '/guest/verification')).status).toBe(204);
    const code = (
      (await ctx.mailbox.latestFor(email, 'guest-verification-code'))!.data as { code: string }
    ).code;
    const wrong = code === '000000' ? '111111' : '000000';
    expect(
      (await guest.request('POST', '/guest/verification/confirm', { code: wrong })).status,
    ).toBe(401);
    const ok = await guest.request('POST', '/guest/verification/confirm', { code });
    expect(ok.status).toBe(200);
    expect(ok.body.verified).toBe(true);
    expect((await guest.request('POST', '/guest/verification/confirm', { code })).status).toBe(401);
    expect((await guest.request('GET', '/guest/bill')).status).toBe(200);
  });
});

describe('self check-in', () => {
  // MNL has two DLX rooms (201, 202) and the business date 2026-10-01.
  it('waits for the check-in time, then assigns a ready room with the front desk rules', async () => {
    const { guest, email, booking, stay } = await guestFor('2026-10-01', '2026-10-03');
    expect(stay.selfCheckInAvailable).toBe(true);
    await verify(guest, email);

    await setCheckInTime('23:59');
    const early = await guest.request('POST', '/guest/check-in');
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('SEE_FRONT_DESK');

    await setCheckInTime('00:00');
    const res = await guest.request('POST', '/guest/check-in');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(['201', '202']).toContain(res.body.roomNumber);
    expect(res.body.access.method).toBe('FRONT_DESK_KEY');

    const after = await guest.request('GET', '/guest/stay');
    expect(after.body.stay.status).toBe('IN_HOUSE');
    expect(after.body.stay.roomNumber).toBe(res.body.roomNumber);
    expect(after.body.selfCheckInAvailable).toBe(false);
    expect((await reception.get(`${base()}/reservations/${booking.id}`)).body.rooms[0].status).toBe(
      'IN_HOUSE',
    );

    const again = await guest.request('POST', '/guest/check-in');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('SEE_FRONT_DESK');

    // Attributed to the guest in the audit trail.
    const app = createPrismaClient({ connectionString: testDatabaseUrls().app, maxConnections: 1 });
    try {
      const org = { organizationId: ctx.world.abc.organizationId, identityId: null };
      const { line, entry } = await withDbContext(app, org, async (tx) => ({
        line: await tx.reservationRoom.findUniqueOrThrow({ where: { id: booking.lineId } }),
        entry: await tx.auditLog.findFirst({
          where: { action: 'stay.checked_in', entityId: booking.id },
        }),
      }));
      expect(entry).toMatchObject({ actorType: 'GUEST', actorId: line.guestId });
    } finally {
      await app.$disconnect();
    }
  });

  it('sends the guest to the front desk when no room is ready', async () => {
    const { guest, email } = await guestFor('2026-10-01', '2026-10-02');
    await verify(guest, email);
    const board = await admin.get(`${base()}/housekeeping`);
    const free = board.body.rooms.filter(
      (r: { number: string; housekeepingStatus: string }) =>
        ['201', '202'].includes(r.number) && r.housekeepingStatus !== 'DIRTY',
    );
    for (const room of free) {
      const res = await admin.request(
        'PUT',
        `${base()}/rooms/${inv().rooms[room.number]}/housekeeping-status`,
        { status: 'DIRTY' },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const res = await guest.request('POST', '/guest/check-in');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEE_FRONT_DESK');
    expect((await guest.request('GET', '/guest/stay')).body.stay.status).toBe('RESERVED');
  });

  it('is only offered on the arrival day', async () => {
    const { guest, email, stay } = await guestFor(...later());
    expect(stay.selfCheckInAvailable).toBe(false);
    await verify(guest, email);
    const res = await guest.request('POST', '/guest/check-in');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEE_FRONT_DESK');
  });

  it('is refused when the organization turns the feature off', async () => {
    const { guest, email } = await guestFor(...later());
    await verify(guest, email);
    const flagUrl = '/api/v1/organization/feature-flags/self_checkin';
    expect((await reception.request('PUT', flagUrl, { enabled: false })).status).toBe(403);
    const off = await admin.request('PUT', flagUrl, { enabled: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    try {
      const res = await guest.request('POST', '/guest/check-in');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FEATURE_DISABLED');
      const flags = await admin.get('/api/v1/organization/feature-flags');
      expect(flags.body.items).toContainEqual(
        expect.objectContaining({ key: 'self_checkin', enabled: false }),
      );
    } finally {
      await admin.request('PUT', flagUrl, { enabled: true });
    }
    const unknown = await admin.request('PUT', '/api/v1/organization/feature-flags/nope', {
      enabled: true,
    });
    expect(unknown.status).toBe(404);
  });
});

describe('service requests', () => {
  /** An in-house STD guest, checked in by the front desk, with a verified portal session. */
  async function inHouseGuest(roomNumber: string) {
    const email = `sr-${randomUUID().slice(0, 8)}@example.test`;
    const booking = await book('2026-10-01', '2026-10-02', email, 'STD');
    const room = `${base()}/reservations/${booking.id}/rooms/${booking.lineId}`;
    const assign = await reception.request('PUT', `${room}/assignment`, {
      roomId: inv().rooms[roomNumber],
    });
    expect(assign.status, JSON.stringify(assign.body)).toBe(200);
    const checkIn = await reception.request('POST', `${room}/check-in`);
    expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(200);
    expect((await sendLink(booking.id)).status).toBe(204);
    const guest = new GuestClient(ctx.app);
    const session = await guest.request('POST', '/guest/session', {
      token: await linkToken(email),
    });
    expect(session.status).toBe(200);
    await verify(guest, email);
    return guest;
  }

  let guest: GuestClient;
  let other: GuestClient;

  beforeAll(async () => {
    guest = await inHouseGuest('103');
    other = await inHouseGuest('104');
  });

  it('need the guest to be in house', async () => {
    const { guest: arriving, email } = await guestFor(...later());
    await verify(arriving, email);
    const res = await arriving.request('POST', '/guest/service-requests', { category: 'TOWELS' });
    expect(res.status).toBe(409);
  });

  it('flow from guest to department to done, then get rated once', async () => {
    const created = await guest.request('POST', '/guest/service-requests', {
      category: 'TOWELS',
      description: 'Two more bath towels',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      department: 'HOUSEKEEPING',
      roomNumber: '103',
      status: 'OPEN',
    });
    expect(created.body.requestNo).toMatch(/^SR-\d{6}$/);
    const id = created.body.id as string;
    const url = `${base()}/service-requests/${id}`;
    const rate = (client: GuestClient, body: object) =>
      client.request('PUT', `/guest/service-requests/${id}/rating`, body);

    const queue = await reception.get(`${base()}/service-requests`);
    expect(queue.status).toBe(200);
    expect(queue.body.items.map((r: { id: string }) => r.id)).toContain(id);
    expect((await hk.get(`${base()}/service-requests`)).status).toBe(403);

    // Another guest neither sees nor rates it.
    expect((await other.request('GET', '/guest/service-requests')).body.items).toEqual([]);
    expect((await rate(other, { rating: 1 })).status).toBe(404);
    // Not done yet.
    expect((await rate(guest, { rating: 5 })).status).toBe(409);

    const current = await reception.get(url);
    const ifMatch = (res: { headers: Record<string, unknown> }) => ({
      'if-match': String(res.headers.etag),
    });
    const ack = await reception.request('PATCH', url, { status: 'ACKNOWLEDGED' }, ifMatch(current));
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    expect(ack.body.acknowledgedAt).not.toBeNull();
    const stale = await reception.request('PATCH', url, { status: 'DONE' }, ifMatch(current));
    expect(stale.status).toBe(412);
    const done = await reception.request('PATCH', url, { status: 'DONE' }, ifMatch(ack));
    expect(done.status).toBe(200);
    expect(done.body.completedAt).not.toBeNull();
    const reopen = await reception.request('PATCH', url, { status: 'IN_PROGRESS' }, ifMatch(done));
    expect(reopen.status).toBe(409);

    const rated = await rate(guest, { rating: 5, feedback: 'Quick!' });
    expect(rated.status).toBe(200);
    expect(rated.body).toMatchObject({ rating: 5, feedback: 'Quick!' });
    expect((await rate(guest, { rating: 4 })).status).toBe(409);
    expect((await guest.request('GET', '/guest/service-requests')).body.items).toHaveLength(1);
  });

  it('staff log requests for a room and assign them to guest service staff only', async () => {
    const created = await reception.request('POST', `${base()}/service-requests`, {
      category: 'MAINTENANCE',
      description: 'Aircon is noisy',
      priority: 'HIGH',
      roomId: inv().rooms['104'],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      department: 'MAINTENANCE',
      priority: 'HIGH',
      roomNumber: '104',
    });
    expect(created.body.guestName).not.toBeNull();

    const members = await admin.get('/api/v1/members');
    const byEmail = (email: string) =>
      members.body.find((m: { email: string }) => m.email === email).membershipId as string;
    const receptionist = byEmail('reception@abc.test');
    const housekeeper = byEmail('hk@abc.test');
    const assignees = await reception.get(`${base()}/service-requests/assignees`);
    expect(assignees.status).toBe(200);
    const ids = assignees.body.items.map((a: { membershipId: string }) => a.membershipId);
    expect(ids).toContain(receptionist);
    expect(ids).not.toContain(housekeeper);

    const url = `${base()}/service-requests/${created.body.id}`;
    const ifMatch = { 'if-match': String(created.headers.etag) };
    const refused = await reception.request(
      'PATCH',
      url,
      { assignedMembershipId: housekeeper },
      ifMatch,
    );
    expect(refused.status).toBe(400);
    const assigned = await reception.request(
      'PATCH',
      url,
      { assignedMembershipId: receptionist },
      ifMatch,
    );
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect(assigned.body.assignee.membershipId).toBe(receptionist);
  });

  it('a guest sees their bill', async () => {
    const bill = await guest.request('GET', '/guest/bill');
    expect(bill.status).toBe(200);
    expect(bill.body.currency).toBe('PHP');
    expect(Array.isArray(bill.body.lines)).toBe(true);
  });
});

describe('hotel events', () => {
  it('guests see upcoming guest-visible events only, without staff details', async () => {
    const at = (days: number, hour: number) =>
      new Date(Date.now() + days * 86_400_000 + hour * 3_600_000).toISOString();
    const create = (title: string, guestVisible: boolean, startsAt: string, endsAt: string) =>
      admin.request('POST', `${base()}/events`, {
        title,
        category: 'GUEST_ACTIVITY',
        startsAt,
        endsAt,
        guestVisible,
        location: 'Pool deck',
      });
    const shown = await create('Pool party', true, at(2, 0), at(2, 3));
    expect(shown.status, JSON.stringify(shown.body)).toBe(201);
    expect((await create('Staff meeting', false, at(2, 0), at(2, 1))).status).toBe(201);
    expect((await create('Next season', true, at(45, 0), at(45, 1))).status).toBe(201);
    const cancelled = await create('Rained out', true, at(3, 0), at(3, 1));
    expect(
      (
        await admin.request(
          'PATCH',
          `${base()}/events/${cancelled.body.id}`,
          { status: 'CANCELLED' },
          { 'if-match': 'W/"1"' },
        )
      ).status,
    ).toBe(200);

    const { guest } = await guestFor(...later());
    const res = await guest.request('GET', '/guest/events');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.items.map((e: { title: string }) => e.title)).toEqual(['Pool party']);
    expect(res.body.items[0]).not.toHaveProperty('participants');
    expect(res.body.items[0]).not.toHaveProperty('organizerName');
    // Not without a guest session.
    expect((await new GuestClient(ctx.app).request('GET', '/guest/events')).status).toBe(401);
  });
});
