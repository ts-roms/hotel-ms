/**
 * PayMongo (ADR-0032) end to end against a local fake of its API: a payment link opens a
 * hosted checkout, the signed webhook posts the payment, and a refund completes when
 * PayMongo's refund event arrives.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FAKE_PAYMONGO_KEY, FAKE_PAYMONGO_WEBHOOK_SECRET, FakePaymongo } from './fake-paymongo.js';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let fake: FakePaymongo;
let admin: TestClient;
let reception: TestClient;
let folioUrl: string;

const MNL = () => ctx.world.abc.properties.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
const inv = () => ctx.world.inventory.MNL;
const idem = () => ({ 'idempotency-key': `test-${randomUUID()}` });
const folio = async () => (await reception.get(folioUrl)).body;

const webhook = (event: { rawBody: string; headers: Record<string, string> }) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/payments/paymongo',
    payload: event.rawBody,
    headers: event.headers,
  });

beforeAll(async () => {
  fake = await new FakePaymongo().start();
  ctx = await startTestApp({
    PAYMENT_PROVIDER: 'paymongo',
    PAYMONGO_SECRET_KEY: FAKE_PAYMONGO_KEY,
    PAYMONGO_WEBHOOK_SECRET: FAKE_PAYMONGO_WEBHOOK_SECRET,
    PAYMONGO_API_BASE: fake.apiBase,
  });
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');

  const booking = await reception.request(
    'POST',
    `${base()}/reservations`,
    {
      source: 'DIRECT',
      booker: { newGuest: { firstName: 'Mona', lastName: 'Gong', email: 'mona@example.test' } },
      rooms: [
        {
          roomTypeId: inv().roomTypes.STD,
          ratePlanId: inv().ratePlans.BAR,
          arrivalDate: '2026-10-01',
          departureDate: '2026-10-03',
          adults: 1,
          roomId: inv().rooms['101'],
        },
      ],
    },
    idem(),
  );
  expect(booking.status, JSON.stringify(booking.body)).toBe(201);
  const line = `${base()}/reservations/${booking.body.id}/rooms/${booking.body.rooms[0].id}`;
  expect((await reception.request('POST', `${line}/check-in`)).status).toBe(200);
  folioUrl = `${base()}/folios/${(await reception.get(`${line}/folio`)).body.id}`;
  const charge = await reception.request(
    'POST',
    `${folioUrl}/charges`,
    { department: 'ROOM', description: 'Room', amountMinor: 350_000 },
    idem(),
  );
  expect(charge.status, JSON.stringify(charge.body)).toBe(200);
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
  await fake?.stop();
});

describe('PayMongo payments', () => {
  let reference: string;

  it('a payment link opens PayMongo checkout; the signed webhook posts the payment', async () => {
    const link = await reception.request(
      'POST',
      `${folioUrl}/payment-links`,
      { amountMinor: 200_000 },
      idem(),
    );
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    expect(link.body).toMatchObject({ provider: 'paymongo', status: 'PENDING' });
    reference = new URL(link.body.checkoutUrl).pathname.slice(1);
    expect(reference).toMatch(/^cs_/);
    expect(fake.requests.at(-1)!.body?.data?.attributes).toMatchObject({
      reference_number: link.body.id,
      line_items: [{ amount: 200_000, currency: 'PHP' }],
    });

    // Nothing is posted before PayMongo says the money arrived.
    expect((await folio()).payments).toHaveLength(0);

    const paid = fake.pay(reference, 'gcash');
    const res = await webhook(paid);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'processed' });
    const payments = (await folio()).payments;
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      provider: 'paymongo',
      method: 'EWALLET',
      amountMinor: 200_000,
    });

    // Redelivery is a no-op; a forged copy is rejected.
    expect((await webhook(paid)).json()).toMatchObject({ outcome: 'duplicate' });
    const forged = { ...paid, rawBody: paid.rawBody.replace('200000', '1') };
    expect((await webhook(forged)).statusCode).toBe(400);
    expect((await folio()).payments).toHaveLength(1);
  });

  it('acknowledges events it does not act on', async () => {
    const res = await webhook(fake.event('payment.paid', { id: 'pay_x', attributes: {} }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'ignored' });
  });

  it('shows PayMongo’s reason when it refuses a checkout', async () => {
    const res = await reception.request(
      'POST',
      `${folioUrl}/payment-links`,
      { amountMinor: 500 },
      idem(),
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PAYMENT_PROVIDER_REJECTED');
    expect(res.body.detail).toBe('PayMongo: Amount must be at least 20.');
  });

  it('a refund goes to PayMongo and completes on its refund event', async () => {
    const payment = (await folio()).payments[0];
    const refund = await admin.request(
      'POST',
      `${base()}/payments/${payment.id}/refunds`,
      { amountMinor: 50_000, reason: 'Early departure' },
      idem(),
    );
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    expect(refund.body).toMatchObject({ status: 'PENDING', amountMinor: 50_000 });
    expect(fake.requests.at(-1)!.path).toBe('/v1/refunds');

    const lookup = await admin.get(`${base()}/payments/${payment.id}/refunds`);
    expect(lookup.body.items[0].status).toBe('PENDING');
    const before = (await folio()).balanceMinor;

    // PayMongo's refund event names the refund id it returned.
    const done = await webhook(fake.refundEvent(fake.refunds.at(-1)!, 'succeeded', 50_000));
    expect(done.json()).toMatchObject({ outcome: 'processed' });
    expect((await admin.get(`${base()}/payments/${payment.id}/refunds`)).body.items[0].status).toBe(
      'SUCCEEDED',
    );
    // Money went back to the payer: the folio owes 50,000 more.
    expect((await folio()).balanceMinor).toBe(before + 50_000);
  });
});
