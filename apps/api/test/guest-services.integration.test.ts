/**
 * Guest services on the portal: hotel information (guest-portal), the guest notification
 * feed and front-desk messages (notifications), and "request checkout"
 * (operations/service-requests). MNL opens on 2026-10-01.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GuestClient,
  guestSession,
  startTestApp,
  type TestContext,
  TestClient,
} from './harness.js';

let ctx: TestContext;
let reception: TestClient;
let admin: TestClient;
let hk: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const inv = () => ctx.world.inventory.MNL;
const F = () => ctx.world.fnb.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
const idem = () => ({ 'idempotency-key': `test-${randomUUID()}` });
const ifMatch = (version: number) => ({ 'if-match': `W/"${version}"` });

let nextNight = 0;
function later(): [string, string] {
  const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n)).toISOString().slice(0, 10);
  const n = nextNight++;
  return [day(n), day(n + 1)];
}

async function book(arrivalDate: string, departureDate: string, email: string, roomType = 'DLX') {
  const res = await reception.request(
    'POST',
    `${base()}/reservations`,
    {
      source: 'DIRECT',
      booker: {
        newGuest: { firstName: 'Ida', lastName: `Guest-${randomUUID().slice(0, 6)}`, email },
      },
      rooms: [
        {
          roomTypeId: inv().roomTypes[roomType],
          ratePlanId: inv().ratePlans.BAR,
          arrivalDate,
          departureDate,
          adults: 1,
        },
      ],
    },
    idem(),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id as string, lineId: res.body.rooms[0].id as string };
}

/** Books, sends the link, opens a guest session and verifies it by email code. */
async function verifiedGuest(arrivalDate: string, departureDate: string, roomType = 'DLX') {
  const email = `gx-${randomUUID().slice(0, 8)}@example.test`;
  const booking = await book(arrivalDate, departureDate, email, roomType);
  const guest = await guestSession(ctx, reception, {
    propertyId: MNL(),
    reservationId: booking.id,
    email,
  });
  return { guest, booking, email };
}

/** An in-house guest in an STD room, checked in by the front desk. */
async function inHouseGuest(roomNumber: string) {
  const g = await verifiedGuest('2026-10-01', '2026-10-02', 'STD');
  const room = `${base()}/reservations/${g.booking.id}/rooms/${g.booking.lineId}`;
  expect(
    (await reception.request('PUT', `${room}/assignment`, { roomId: inv().rooms[roomNumber] }))
      .status,
  ).toBe(200);
  const checkIn = await reception.request('POST', `${room}/check-in`);
  expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(200);
  return { ...g, room };
}

const staffInbox = async (client: TestClient) =>
  (await client.get('/api/v1/me/notifications')).body.items as { kind: string; title: string }[];

const guestFeed = async (guest: GuestClient) =>
  (await guest.request('GET', '/guest/notifications')).body.items as {
    kind: string;
    title: string;
    body: string;
    read: boolean;
  }[];

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

describe('hotel information', () => {
  it('is edited with property.settings.manage and shown to guests', async () => {
    const url = `${base()}/guest-portal-settings`;
    expect((await reception.get(url)).body).toMatchObject({ about: '', amenities: [] });
    const body = {
      about: 'A calm hotel by the bay.',
      wifiName: 'Bayview-Guest',
      wifiPassword: 'sunset2026',
      amenities: ['Pool', 'Gym'],
      services: [
        { name: 'Airport shuttle', description: 'Book a day ahead', hours: '06:00–22:00' },
      ],
      houseRules: 'Quiet hours from 22:00.',
    };
    expect((await reception.request('PUT', url, body)).status).toBe(403);
    expect((await admin.request('PUT', url, { ...body, extra: true })).status).toBe(400);
    const saved = await admin.request('PUT', url, body);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ ...body, requireIdForSelfCheckIn: false });

    // Before arrival: everything but the Wi-Fi.
    const { guest } = await verifiedGuest(...later());
    const info = await guest.request('GET', '/guest/hotel-info');
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({
      name: expect.any(String),
      about: 'A calm hotel by the bay.',
      amenities: ['Pool', 'Gym'],
      services: [body.services[0]],
      wifi: null,
    });

    const inHouse = await inHouseGuest('101');
    expect((await inHouse.guest.request('GET', '/guest/hotel-info')).body.wifi).toEqual({
      name: 'Bayview-Guest',
      password: 'sunset2026',
    });
  });
});

describe('guest notifications and checkout', () => {
  let g: Awaited<ReturnType<typeof inHouseGuest>>;

  beforeAll(async () => {
    g = await inHouseGuest('103');
  });

  it('follow service requests and can be marked read', async () => {
    const created = await g.guest.request('POST', '/guest/service-requests', {
      category: 'TOWELS',
    });
    expect(created.status).toBe(201);
    const ack = await reception.request(
      'PATCH',
      `${base()}/service-requests/${created.body.id}`,
      { status: 'ACKNOWLEDGED' },
      ifMatch(created.body.version),
    );
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    const feed = await guestFeed(g.guest);
    expect(feed[0]).toMatchObject({
      kind: 'SERVICE_REQUEST',
      title: "We're on it: Towels",
      read: false,
    });
    expect((await g.guest.request('GET', '/guest/stay')).body.unreadNotifications).toBe(1);
    expect((await g.guest.request('POST', '/guest/notifications/read')).status).toBe(204);
    expect((await g.guest.request('GET', '/guest/stay')).body.unreadNotifications).toBe(0);
  });

  it('carry messages from the front desk', async () => {
    const url = `${g.room}/guest-message`;
    const message = { title: 'Your room upgrade is ready', body: 'Enjoy the view.' };
    expect((await hk.request('POST', url, message)).status).toBe(403);
    expect((await reception.request('POST', url, message)).status).toBe(204);
    expect(await guestFeed(g.guest)).toContainEqual(
      expect.objectContaining({ kind: 'MESSAGE', ...message }),
    );
  });

  it('checkout is requested once, and checking out closes the request', async () => {
    // Only through "Request checkout".
    expect(
      (await g.guest.request('POST', '/guest/service-requests', { category: 'CHECKOUT' })).status,
    ).toBe(400);
    const res = await g.guest.request('POST', '/guest/checkout-request', {
      time: '11:30',
      note: 'Please call a taxi',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      category: 'CHECKOUT',
      department: 'FRONT_DESK',
      status: 'OPEN',
      description: 'Leaving at 11:30. Please call a taxi',
      roomNumber: '103',
    });
    expect((await g.guest.request('POST', '/guest/checkout-request', {})).status).toBe(409);
    expect((await g.guest.request('GET', '/guest/stay')).body.checkoutRequested).toBe(true);
    expect(await staffInbox(reception)).toContainEqual(
      expect.objectContaining({
        kind: 'CHECKOUT_REQUESTED',
        title: 'Checkout requested: room 103',
      }),
    );

    const out = await reception.request('POST', `${g.room}/check-out`);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const request = await reception.get(`${base()}/service-requests/${res.body.id}`);
    expect(request.body.status).toBe('DONE');
    const stay = await g.guest.request('GET', '/guest/stay');
    expect(stay.body).toMatchObject({ checkoutRequested: false });
    expect(stay.body.stay.status).toBe('CHECKED_OUT');
    expect(await guestFeed(g.guest)).toContainEqual(
      expect.objectContaining({ kind: 'CHECKOUT', title: "You're checked out" }),
    );
    // No more requests once gone.
    expect((await g.guest.request('POST', '/guest/checkout-request', {})).status).toBe(409);
  });

  it('follow room-service orders', async () => {
    const other = await inHouseGuest('104');
    const placed = await reception.request(
      'POST',
      `${base()}/orders`,
      {
        outletId: F().outlets.IRD,
        chargeMethod: 'ROOM_CHARGE',
        roomId: inv().rooms['104'],
        items: [{ menuItemId: F().items.Tapsilog, quantity: 1 }],
      },
      idem(),
    );
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    let version = placed.body.version as number;
    for (const status of ['PREPARING', 'READY', 'OUT_FOR_DELIVERY']) {
      const step = await admin.request(
        'POST',
        `${base()}/orders/${placed.body.id}/status`,
        { status },
        ifMatch(version),
      );
      expect(step.status, JSON.stringify(step.body)).toBe(200);
      version = step.body.version;
    }
    const titles = (await guestFeed(other.guest)).map((n) => n.title);
    expect(titles).toContain(`Order ${placed.body.orderNo} is on its way`);
    // A room order is delivered, not collected.
    expect(titles).not.toContain(`Order ${placed.body.orderNo} is ready for pickup`);
  });
});
