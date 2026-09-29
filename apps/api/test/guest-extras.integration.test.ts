/**
 * Guest portal extras (ADR-0027): the guest ID with front-desk review and retention, the
 * property's ID rule for self check-in, hotel information, the guest notification feed,
 * and "request checkout". MNL opens on 2026-10-01.
 */
import { randomUUID } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GuestIdentityService } from '../src/modules/pms/guests/guest-identity.service.js';
import {
  GuestClient,
  Mailbox,
  SELFIE,
  startTestApp,
  type TestContext,
  TestClient,
} from './harness.js';

let ctx: TestContext;
/** Reception, enrolled in two-step verification: guest IDs are sensitive. */
let reception: TestClient;
let desk: TestClient;
/** What reception got for the ID queue before enrolling. */
let beforeMfa: { status: number; code: string };
let admin: TestClient;
let hk: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const inv = () => ctx.world.inventory.MNL;
const F = () => ctx.world.fnb.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
const idem = () => ({ 'idempotency-key': `test-${randomUUID()}` });
const ifMatch = (version: number) => ({ 'if-match': `W/"${version}"` });
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

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
  expect(
    (await reception.request('POST', `${base()}/reservations/${booking.id}/guest-portal-link`))
      .status,
  ).toBe(204);
  const mail = await ctx.mailbox.latestFor(email, 'guest-portal-link');
  const token = Mailbox.tokenFrom((mail!.data as { portalUrl: string }).portalUrl);
  const guest = new GuestClient(ctx.app);
  expect((await guest.request('POST', '/guest/session', { token })).status).toBe(200);
  const unverified = { guest, booking, email };
  expect((await guest.request('POST', '/guest/verification')).status).toBe(204);
  const code = (
    (await ctx.mailbox.latestFor(email, 'guest-verification-code'))!.data as {
      code: string;
    }
  ).code;
  expect((await guest.request('POST', '/guest/verification/confirm', { code })).status).toBe(200);
  return unverified;
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

const upload = (guest: GuestClient, body: Buffer, type: string, documentType = 'PASSPORT') =>
  guest.request('POST', `/guest/identity?documentType=${documentType}`, body, {
    'content-type': type,
  });

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
  const plain = await TestClient.as(ctx.app, 'reception@abc.test');
  const res = await plain.get(`${base()}/guest-ids`);
  beforeMfa = { status: res.status, code: res.body.code };
  // Enrolling signs out the other session; reception works with this one from now on.
  reception = desk = await TestClient.withMfa(ctx.app, 'reception@abc.test');
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('guest ID', () => {
  let guest: GuestClient;
  let documentId: string;

  it('verified guests upload an ID; the file must be what it claims', async () => {
    const g = await verifiedGuest(...later());
    guest = g.guest;

    const res = await upload(guest, SELFIE, 'image/jpeg');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.identity).toMatchObject({
      documentType: 'PASSPORT',
      status: 'PENDING',
      rejectionReason: null,
    });
    expect((await upload(guest, Buffer.from('hello'), 'text/plain')).status).toBe(415);
    expect((await upload(guest, PNG, 'image/jpeg')).status).toBe(415);

    // Not before the email code is confirmed.
    const email = `gx-${randomUUID().slice(0, 8)}@example.test`;
    const booking = await book(...later(), email);
    await reception.request('POST', `${base()}/reservations/${booking.id}/guest-portal-link`);
    const token = Mailbox.tokenFrom(
      ((await ctx.mailbox.latestFor(email, 'guest-portal-link'))!.data as { portalUrl: string })
        .portalUrl,
    );
    const unverified = new GuestClient(ctx.app);
    await unverified.request('POST', '/guest/session', { token });
    const refused = await upload(unverified, SELFIE, 'image/jpeg');
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('GUEST_VERIFICATION_REQUIRED');
  });

  it('the front desk is told, and reviews with two-step verification', async () => {
    expect(await staffInbox(reception)).toContainEqual(
      expect.objectContaining({ kind: 'GUEST_ID_SUBMITTED', title: 'Guest ID to review' }),
    );
    expect(beforeMfa).toEqual({ status: 403, code: 'MFA_ENROLLMENT_REQUIRED' });
    expect((await hk.get(`${base()}/guest-ids`)).status).toBe(403);

    const list = await desk.get(`${base()}/guest-ids`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const doc = list.body.items.find((d: { status: string }) => d.status === 'PENDING');
    expect(doc).toMatchObject({
      documentType: 'PASSPORT',
      contentType: 'image/jpeg',
      stayStatus: 'RESERVED',
      purged: false,
      version: 1,
    });
    documentId = doc.id;

    const file = await desk.get(`${base()}/guest-ids/${documentId}/content`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.headers['cache-control']).toBe('private, no-store');
  });

  it('a rejection needs a reason and asks the guest to upload again', async () => {
    const path = `${base()}/guest-ids/${documentId}/review`;
    expect((await desk.request('POST', path, { decision: 'REJECT' }, ifMatch(1))).status).toBe(400);
    const res = await desk.request(
      'POST',
      path,
      { decision: 'REJECT', reason: 'The photo is blurry' },
      ifMatch(1),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'The photo is blurry',
      reviewerName: 'Rey Reception',
    });
    expect((await desk.request('POST', path, { decision: 'APPROVE' }, ifMatch(2))).status).toBe(
      409,
    );

    const stay = await guest.request('GET', '/guest/stay');
    expect(stay.body.identity).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'The photo is blurry',
    });
    expect(await guestFeed(guest)).toContainEqual(
      expect.objectContaining({
        kind: 'IDENTITY',
        title: 'Please upload your ID again',
        body: 'The photo is blurry',
      }),
    );
  });

  it('a new upload replaces the rejected one; once approved it is final', async () => {
    const res = await upload(guest, PDF, 'application/pdf', 'NATIONAL_ID');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.identity).toMatchObject({ documentType: 'NATIONAL_ID', status: 'PENDING' });
    // The rejected file is gone at once.
    expect((await desk.get(`${base()}/guest-ids/${documentId}/content`)).status).toBe(410);

    const pending = (await desk.get(`${base()}/guest-ids`)).body.items.find(
      (d: { documentType: string }) => d.documentType === 'NATIONAL_ID',
    );
    const approved = await desk.request(
      'POST',
      `${base()}/guest-ids/${pending.id}/review`,
      { decision: 'APPROVE' },
      ifMatch(pending.version),
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await guest.request('GET', '/guest/stay')).body.identity.status).toBe('APPROVED');
    expect(await guestFeed(guest)).toContainEqual(
      expect.objectContaining({ kind: 'IDENTITY', title: 'Your ID is approved' }),
    );
    expect((await upload(guest, SELFIE, 'image/jpeg')).status).toBe(409);
    documentId = pending.id;
  });

  it('files are deleted 30 days after departure; the record stays', async () => {
    const service = ctx.app.get(GuestIdentityService);
    const cls = ctx.app.get(ClsService);
    const purge = (now: Date) =>
      cls.run(() => {
        cls.set('system', true);
        cls.set('organizationId', ctx.world.abc.organizationId);
        return service.purge(now);
      });
    expect(await purge(new Date('2026-11-15T00:00:00Z'))).toBe(0);
    expect(await purge(new Date('2027-06-01T00:00:00Z'))).toBeGreaterThan(0);
    expect((await desk.get(`${base()}/guest-ids/${documentId}/content`)).status).toBe(410);
    const history = await desk.get(`${base()}/guest-ids?status=APPROVED`);
    expect(history.body.items).toContainEqual(
      expect.objectContaining({ id: documentId, status: 'APPROVED', purged: true }),
    );
  });
});

describe('self check-in ID rule', () => {
  const settingsUrl = () => `${base()}/guest-portal-settings`;

  afterAll(async () => {
    await admin.request('PUT', settingsUrl(), { requireIdForSelfCheckIn: false });
  });

  it('asks for an approved ID before handing over the room', async () => {
    const current = await admin.get(`${base()}`);
    const opened = await admin.request(
      'PATCH',
      base(),
      { checkInTime: '00:00' },
      { 'if-match': String(current.headers.etag) },
    );
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    expect(
      (await admin.request('PUT', settingsUrl(), { requireIdForSelfCheckIn: true })).status,
    ).toBe(200);

    const { guest } = await verifiedGuest('2026-10-01', '2026-10-02');
    const stay = await guest.request('GET', '/guest/stay');
    expect(stay.body).toMatchObject({ identityRequired: true, identity: null });
    const first = await guest.request('POST', '/guest/check-in');
    expect(first.status).toBe(409);
    expect(first.body.code).toBe('ID_REQUIRED');

    expect((await upload(guest, SELFIE, 'image/jpeg', 'DRIVERS_LICENSE')).status).toBe(200);
    const pending = await guest.request('POST', '/guest/check-in');
    expect(pending.body.code).toBe('ID_REVIEW_PENDING');

    const doc = (await desk.get(`${base()}/guest-ids`)).body.items.find(
      (d: { documentType: string }) => d.documentType === 'DRIVERS_LICENSE',
    );
    await desk.request(
      'POST',
      `${base()}/guest-ids/${doc.id}/review`,
      { decision: 'APPROVE' },
      ifMatch(doc.version),
    );
    const res = await guest.request('POST', '/guest/check-in');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
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
