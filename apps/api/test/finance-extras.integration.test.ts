/**
 * Finance extras (ADR-0018): foreign cash at the property's exchange rate, statutory
 * discounts (PH senior citizen / PWD), refunds completed by webhook, and card holds that
 * gate guest self check-in.
 */
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, withDbContext } from '@hotel/database';
import { testDatabaseUrls } from '@hotel/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SandboxProvider } from '../src/modules/finance/payments/providers.js';
import { Mailbox, startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let reception: TestClient;
let hk: TestClient;
let sandbox: SandboxProvider;

const MNL = () => ctx.world.abc.properties.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
const inv = () => ctx.world.inventory.MNL;
const idem = () => ({ 'idempotency-key': `test-${randomUUID()}` });

interface Line {
  id: string;
  type: string;
  description: string;
  amountMinor: number;
}

async function book(input: {
  arrivalDate: string;
  departureDate: string;
  roomType: string;
  roomNumber?: string;
  email: string;
}) {
  const res = await reception.request(
    'POST',
    `${base()}/reservations`,
    {
      source: 'DIRECT',
      booker: { newGuest: { firstName: 'Fe', lastName: 'Extras', email: input.email } },
      rooms: [
        {
          roomTypeId: inv().roomTypes[input.roomType],
          ratePlanId: inv().ratePlans.BAR,
          arrivalDate: input.arrivalDate,
          departureDate: input.departureDate,
          adults: 1,
          ...(input.roomNumber ? { roomId: inv().rooms[input.roomNumber] } : {}),
        },
      ],
    },
    idem(),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id as string, lineId: res.body.rooms[0].id as string };
}

async function checkedInFolio(roomNumber: string): Promise<string> {
  const booking = await book({
    arrivalDate: '2026-10-01',
    departureDate: '2026-10-03',
    roomType: 'STD',
    roomNumber,
    email: `fx-${randomUUID().slice(0, 8)}@example.test`,
  });
  const line = `${base()}/reservations/${booking.id}/rooms/${booking.lineId}`;
  const checkIn = await reception.request('POST', `${line}/check-in`);
  expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(200);
  return (await reception.get(`${line}/folio`)).body.id as string;
}

async function charge(folioId: string, department: string, amountMinor: number) {
  const res = await reception.request(
    'POST',
    `${base()}/folios/${folioId}/charges`,
    { department, description: `${department} test`, amountMinor },
    idem(),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function payAtSandbox(checkoutUrl: string, outcome: 'pay' | 'decline') {
  const path = new URL(checkoutUrl).pathname;
  const page = await ctx.app.inject({ method: 'GET', url: path });
  expect(page.statusCode).toBe(200);
  return {
    page: page.body,
    result: await ctx.app.inject({
      method: 'POST',
      url: `${path}/${outcome}`,
      payload: 'method=CARD',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: new URL(checkoutUrl).origin,
      },
    }),
  };
}

const webhook = (event: { rawBody: string; headers: Record<string, string> }) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/payments/sandbox',
    payload: event.rawBody,
    headers: event.headers,
  });

/** Reads rows the API does not expose, as the tenant (RLS applies). */
async function asTenant<T>(fn: Parameters<typeof withDbContext<T>>[2]): Promise<T> {
  const app = createPrismaClient({ connectionString: testDatabaseUrls().app, maxConnections: 1 });
  try {
    return await withDbContext(
      app,
      { organizationId: ctx.world.abc.organizationId, identityId: null },
      fn,
    );
  } finally {
    await app.$disconnect();
  }
}

/** A guest's browser on the portal: its cookie, CSRF token and Origin. */
class GuestClient {
  private cookie: string | undefined;
  private csrf: string | undefined;

  constructor(private readonly app: NestFastifyApplication) {}

  async request(
    method: 'GET' | 'POST',
    url: string,
    body: object = {},
    headers: Record<string, string> = {},
  ) {
    const res = await this.app.inject({
      method,
      url: `/api/v1${url}`,
      ...(method === 'POST' ? { payload: body } : {}),
      headers: {
        origin: 'http://localhost:43200',
        'x-forwarded-for': '10.77.0.1',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrf && method !== 'GET' ? { 'x-csrf-token': this.csrf } : {}),
        ...headers,
      },
    });
    const c = res.cookies.find((x) => x.name === 'hotel_guest');
    if (c) this.cookie = `hotel_guest=${c.value}`;
    const parsed =
      res.body && String(res.headers['content-type']).includes('json')
        ? JSON.parse(res.body)
        : null;
    if (parsed?.csrfToken) this.csrf = parsed.csrfToken;
    return { status: res.statusCode, body: parsed };
  }
}

async function verifiedGuest(reservationId: string, email: string): Promise<GuestClient> {
  expect(
    (await reception.request('POST', `${base()}/reservations/${reservationId}/guest-portal-link`))
      .status,
  ).toBe(204);
  const link = await ctx.mailbox.latestFor(email, 'guest-portal-link');
  const guest = new GuestClient(ctx.app);
  const token = Mailbox.tokenFrom((link!.data as { portalUrl: string }).portalUrl);
  expect((await guest.request('POST', '/guest/session', { token })).status).toBe(200);
  expect((await guest.request('POST', '/guest/verification')).status).toBe(204);
  const mail = await ctx.mailbox.latestFor(email, 'guest-verification-code');
  const code = (mail!.data as { code: string }).code;
  expect((await guest.request('POST', '/guest/verification/confirm', { code })).status).toBe(200);
  return guest;
}

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
  sandbox = new SandboxProvider(ctx.env);
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('foreign cash', () => {
  it('converts at the current rate, keeps the rate on the payment, and counts notes per currency', async () => {
    const folioId = await checkedInFolio('101');
    const folioUrl = `${base()}/folios/${folioId}`;
    await charge(folioId, 'ROOM', 1_000_000);
    const shift = await reception.request('POST', `${base()}/cashier/shift`, {
      openingFloatMinor: 0,
    });
    expect(shift.status, JSON.stringify(shift.body)).toBe(201);

    const pay = (body: object) => reception.request('POST', `${folioUrl}/payments`, body, idem());
    const usd = { method: 'CASH', tendered: { currency: 'USD', amountMinor: 10_000 } };
    const noRate = await pay(usd);
    expect(noRate.status).toBe(409);
    expect(noRate.body.code).toBe('NO_EXCHANGE_RATE');

    const rates = `${base()}/exchange-rates`;
    expect(
      (await reception.request('POST', rates, { currency: 'USD', rate: '56.25' })).status,
    ).toBe(403);
    expect((await admin.request('POST', rates, { currency: 'PHP', rate: '1' })).status).toBe(400);
    expect(
      (await admin.request('POST', rates, { currency: 'USD', rate: '56.1234567' })).status,
    ).toBe(400);
    const set = await admin.request('POST', rates, { currency: 'USD', rate: '56.25' });
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    expect(set.body).toMatchObject({ currency: 'USD', rate: '56.25' });

    expect((await pay({ ...usd, method: 'CARD' })).status).toBe(400);
    expect((await pay({ ...usd, amountMinor: 100 })).status).toBe(400);
    const paid = await pay(usd);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    // USD 100.00 × 56.25 = PHP 5,625.00
    expect(paid.body.balanceMinor).toBe(1_000_000 - 562_500);
    expect(paid.body.payments.at(-1)).toMatchObject({
      method: 'CASH',
      amountMinor: 562_500,
      tendered: { currency: 'USD', amountMinor: 10_000, rate: '56.25' },
    });

    // A new rate applies from now on; the earlier payment keeps its own.
    expect((await admin.request('POST', rates, { currency: 'USD', rate: '57' })).status).toBe(201);
    const jpy = await admin.request('POST', rates, { currency: 'JPY', rate: '0.382' });
    expect(jpy.status).toBe(201);
    const yen = await pay({ method: 'CASH', tendered: { currency: 'JPY', amountMinor: 5_000 } });
    expect(yen.status, JSON.stringify(yen.body)).toBe(200);
    // JPY 5,000 × 0.382 = PHP 1,910.00 (yen has no minor unit)
    expect(yen.body.payments.at(-1).amountMinor).toBe(191_000);
    expect(yen.body.payments.at(-2).tendered.rate).toBe('56.25');
    const list = await reception.get(rates);
    expect(list.body.items.map((r: { currency: string; rate: string }) => r.rate)).toEqual([
      '0.382',
      '57',
      '56.25',
    ]);

    const current = await reception.get(`${base()}/cashier/shift`);
    expect(current.body.shift.cashInMinor).toBe(562_500 + 191_000);
    expect(current.body.shift.foreignCash).toEqual([
      { currency: 'JPY', amountMinor: 5_000 },
      { currency: 'USD', amountMinor: 10_000 },
    ]);
  });
});

describe('statutory discounts', () => {
  it('senior citizen: 20% off the VAT-exclusive price, VAT-exempt, on covered departments only', async () => {
    const profiles = await reception.get(`${base()}/discount-profiles`);
    expect(profiles.status).toBe(200);
    const senior = profiles.body.items.find((p: { code: string }) => p.code === 'SENIOR');
    expect(senior).toMatchObject({
      discountPercent: 20,
      exemptTaxCodes: ['VAT'],
      departments: ['ROOM', 'FNB'],
      active: true,
    });

    const folioId = await checkedInFolio('102');
    const url = `${base()}/folios/${folioId}/discount`;
    const body = { profileId: senior.id, holderName: 'Lola Remedios', idNumber: 'OSCA 0012 3456' };
    expect((await hk.request('PUT', url, body)).status).toBe(403);
    const applied = await reception.request('PUT', url, body);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(applied.body.discount).toEqual({
      profileId: senior.id,
      code: 'SENIOR',
      name: 'Senior citizen',
      holderName: 'Lola Remedios',
      idLast4: '3456',
    });
    expect(JSON.stringify(applied.body)).not.toContain('OSCA');
    const stored = await asTenant((tx) =>
      tx.folio.findUniqueOrThrow({ where: { id: folioId }, select: { discountIdEncrypted: true } }),
    );
    expect(Buffer.from(stored.discountIdEncrypted!).toString('latin1')).not.toContain('0012');

    // ₱3,500 incl. 12% VAT → ₱3,125 VAT-exempt base → 20% off (₱625) → ₱2,500.
    const room = await charge(folioId, 'ROOM', 350_000);
    expect(room.balanceMinor).toBe(250_000);
    const lines = room.lines as Line[];
    const roomLine = lines.find((l) => l.type === 'CHARGE')!;
    expect(roomLine).toMatchObject({ amountMinor: 312_500, description: 'ROOM test (VAT-exempt)' });
    expect(lines.filter((l) => l.type === 'TAX')).toHaveLength(0);
    expect(lines.find((l) => l.type === 'ADJUSTMENT')).toMatchObject({
      amountMinor: -62_500,
      description: 'Senior citizen discount (20%)',
    });

    // The minibar is not covered: full price with VAT.
    const minibar = await charge(folioId, 'MINIBAR', 11_200);
    expect(minibar.balanceMinor).toBe(250_000 + 11_200);

    // Voiding the room charge takes the discount back with it.
    const voided = await reception.request(
      'POST',
      `${base()}/folios/${folioId}/lines/${roomLine.id}/void`,
      { reason: 'Wrong room' },
    );
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    expect(voided.body.balanceMinor).toBe(11_200);

    const removed = await reception.request('DELETE', url);
    expect(removed.status).toBe(200);
    expect(removed.body.discount).toBeNull();
    expect((await charge(folioId, 'ROOM', 350_000)).balanceMinor).toBe(11_200 + 350_000);
  });

  it('profiles are property configuration, managed with tax.manage', async () => {
    const url = `${base()}/discount-profiles`;
    const body = {
      code: 'SOLO',
      name: 'Solo parent',
      discountPercent: 10,
      exemptTaxCodes: [],
      departments: ['FNB'],
    };
    expect((await reception.request('POST', url, body)).status).toBe(403);
    expect((await admin.request('POST', url, { ...body, departments: ['NOPE'] })).status).toBe(400);
    const created = await admin.request('POST', url, body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ code: 'SOLO', discountPercent: 10, active: true });
    expect((await admin.request('POST', url, body)).status).toBe(409);
    expect((await admin.request('POST', `${url}/${created.body.id}/archive`)).status).toBe(204);
    expect((await admin.request('POST', `${url}/${created.body.id}/archive`)).status).toBe(404);

    const folioId = await checkedInFolio('103');
    const apply = await reception.request('PUT', `${base()}/folios/${folioId}/discount`, {
      profileId: created.body.id,
      holderName: 'Solo Parent',
      idNumber: 'SP-99887766',
    });
    expect(apply.status).toBe(400);
  });
});

describe('refunds completed by webhook', () => {
  it('a pending refund posts to the folio only when the provider confirms it', async () => {
    const folioId = await checkedInFolio('104');
    const folioUrl = `${base()}/folios/${folioId}`;
    await charge(folioId, 'ROOM', 350_000);
    const link = await reception.request(
      'POST',
      `${folioUrl}/payment-links`,
      { amountMinor: 350_000 },
      idem(),
    );
    expect(link.status).toBe(201);
    await payAtSandbox(link.body.checkoutUrl, 'pay');
    const payment = (await reception.get(folioUrl)).body.payments[0];
    expect((await reception.get(folioUrl)).body.balanceMinor).toBe(0);
    const url = `${base()}/payments/${payment.id}/refunds`;

    // The sandbox leaves amounts ending in 13 pending, like test amounts at real gateways.
    const pending = await admin.request(
      'POST',
      url,
      { amountMinor: 10_013, reason: 'Late checkout waived' },
      idem(),
    );
    expect(pending.status, JSON.stringify(pending.body)).toBe(201);
    expect(pending.body.status).toBe('PENDING');
    expect((await reception.get(folioUrl)).body.balanceMinor).toBe(0);
    const failing = await admin.request(
      'POST',
      url,
      { amountMinor: 5_013, reason: 'Goodwill' },
      idem(),
    );
    expect(failing.body.status).toBe('PENDING');
    // Pending refunds count against what can still be refunded.
    const tooMuch = await admin.request(
      'POST',
      url,
      { amountMinor: 350_000 - 15_025, reason: 'Too much' },
      idem(),
    );
    expect(tooMuch.status).toBe(409);

    const refs = await asTenant((tx) =>
      tx.refund.findMany({
        where: { id: { in: [pending.body.id, failing.body.id] } },
        select: { id: true, provider: true, providerRef: true },
      }),
    );
    const refOf = (id: string) => refs.find((r) => r.id === id)!;
    expect(refOf(pending.body.id).provider).toBe('sandbox');

    const succeeded = sandbox.event({
      type: 'refund.succeeded',
      reference: refOf(pending.body.id).providerRef!,
      amountMinor: 10_013,
      currency: 'PHP',
    });
    const first = await webhook(succeeded);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().outcome).toBe('processed');
    expect((await webhook(succeeded)).json().outcome).toBe('duplicate');
    const after = await reception.get(folioUrl);
    expect(after.body.balanceMinor).toBe(10_013);

    const failed = await webhook(
      sandbox.event({
        type: 'refund.failed',
        reference: refOf(failing.body.id).providerRef!,
        amountMinor: 5_013,
        currency: 'PHP',
      }),
    );
    expect(failed.json().outcome).toBe('processed');
    // A late "succeeded" for a refund already failed changes nothing.
    const late = await webhook(
      sandbox.event({
        type: 'refund.succeeded',
        reference: refOf(failing.body.id).providerRef!,
        amountMinor: 5_013,
        currency: 'PHP',
      }),
    );
    expect(late.json().outcome).toBe('ignored');
    expect((await reception.get(folioUrl)).body.balanceMinor).toBe(10_013);

    const list = await reception.get(url);
    expect(
      list.body.items.map((r: { amountMinor: number; status: string }) => [
        r.amountMinor,
        r.status,
      ]),
    ).toEqual([
      [10_013, 'SUCCEEDED'],
      [5_013, 'FAILED'],
    ]);
  });
});

describe('card holds for self check-in', () => {
  const settingsUrl = () => `${base()}/payment-settings`;

  it('self check-in waits for an authorized hold; staff capture it at check-out', async () => {
    expect((await reception.get(settingsUrl())).body).toEqual({ selfCheckInHoldMinor: 0 });
    expect(
      (await reception.request('PUT', settingsUrl(), { selfCheckInHoldMinor: 500_000 })).status,
    ).toBe(403);
    const set = await admin.request('PUT', settingsUrl(), { selfCheckInHoldMinor: 500_000 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const property = await admin.get(`/api/v1/properties/${MNL()}`);
    expect(
      (
        await admin.request(
          'PATCH',
          `/api/v1/properties/${MNL()}`,
          { checkInTime: '00:00' },
          { 'if-match': String(property.headers.etag) },
        )
      ).status,
    ).toBe(200);

    const email = `hold-${randomUUID().slice(0, 8)}@example.test`;
    const booking = await book({
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-02',
      roomType: 'DLX',
      email,
    });
    const guest = await verifiedGuest(booking.id, email);
    const stay = await guest.request('GET', '/guest/stay');
    expect(stay.body.cardHold).toEqual({
      requiredMinor: 500_000,
      currency: 'PHP',
      authorized: false,
    });

    const blocked = await guest.request('POST', '/guest/check-in');
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('HOLD_REQUIRED');

    const hold = await guest.request('POST', '/guest/holds', {}, idem());
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    expect(hold.body).toMatchObject({
      kind: 'HOLD',
      status: 'PENDING',
      amountMinor: 500_000,
      folioId: null,
      reservationRoomId: booking.lineId,
    });
    // A second tap reuses the open checkout instead of placing another hold.
    const again = await guest.request('POST', '/guest/holds', {}, idem());
    expect(again.body.id).toBe(hold.body.id);

    const { page, result } = await payAtSandbox(hold.body.checkoutUrl, 'pay');
    expect(page).toContain('Authorize a hold of');
    expect(result.headers.location).toBe(`${ctx.env.GUEST_PUBLIC_URL}/stay?hold=${hold.body.id}`);
    expect((await guest.request('GET', '/guest/stay')).body.cardHold.authorized).toBe(true);
    // Authorizing moves no money.
    const checkedIn = await guest.request('POST', '/guest/check-in');
    expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);

    const folio = (
      await reception.get(`${base()}/reservations/${booking.id}/rooms/${booking.lineId}/folio`)
    ).body;
    expect(folio.payments).toHaveLength(0);
    const intents = await reception.get(`${base()}/folios/${folio.id}/payment-intents`);
    expect(intents.body.items).toContainEqual(
      expect.objectContaining({ id: hold.body.id, kind: 'HOLD', status: 'AUTHORIZED' }),
    );

    await charge(folio.id, 'MINIBAR', 30_000);
    const captureUrl = `${base()}/holds/${hold.body.id}/capture`;
    expect(
      (await reception.request('POST', captureUrl, { amountMinor: 500_001 }, idem())).status,
    ).toBe(400);
    const captured = await reception.request('POST', captureUrl, { amountMinor: 30_000 }, idem());
    expect(captured.status, JSON.stringify(captured.body)).toBe(200);
    expect(captured.body).toMatchObject({
      status: 'SUCCEEDED',
      capturedMinor: 30_000,
      folioId: folio.id,
    });
    const settled = (await reception.get(`${base()}/folios/${folio.id}`)).body;
    expect(settled.payments).toEqual([
      expect.objectContaining({ method: 'CARD', amountMinor: 30_000, provider: 'sandbox' }),
    ]);
    expect(
      (await reception.request('POST', captureUrl, { amountMinor: 1_000 }, idem())).body.code,
    ).toBe('INVALID_STATE');
    expect(
      (await reception.request('POST', `${base()}/holds/${hold.body.id}/release`)).status,
    ).toBe(409);
  });

  it('a hold left behind by a cancelled stay is flagged until released', async () => {
    const email = `hold-${randomUUID().slice(0, 8)}@example.test`;
    const booking = await book({
      arrivalDate: '2026-10-10',
      departureDate: '2026-10-11',
      roomType: 'DLX',
      email,
    });
    const guest = await verifiedGuest(booking.id, email);
    const hold = await guest.request('POST', '/guest/holds', {}, idem());
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    await payAtSandbox(hold.body.checkoutUrl, 'pay');

    const reconciliation = () => admin.get(`${base()}/reports/reconciliation`);
    const staleFor = async () =>
      (await reconciliation()).body.issues.filter(
        (i: { code: string; reference: string }) =>
          i.code === 'STALE_HOLD' && i.reference === hold.body.id,
      );
    expect(await staleFor()).toHaveLength(0);

    const cancelled = await reception.request(
      'POST',
      `${base()}/reservations/${booking.id}/cancel`,
      { reason: 'Plans changed' },
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(await staleFor()).toHaveLength(1);

    const released = await reception.request('POST', `${base()}/holds/${hold.body.id}/release`);
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    expect(released.body.status).toBe('CANCELLED');
    expect(await staleFor()).toHaveLength(0);
    // Cancelling the booking also ended the guest's portal session.
    expect((await guest.request('GET', '/guest/payments')).status).toBe(401);

    const off = await admin.request('PUT', settingsUrl(), { selfCheckInHoldMinor: 0 });
    expect(off.status).toBe(200);
  });
});
