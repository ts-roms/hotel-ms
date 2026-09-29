/**
 * Finance (blueprint §15): online payments through the sandbox gateway with signed,
 * deduplicated webhooks; refunds capped under a lock; cashier shifts; company accounts,
 * routing and transfers; gap-free invoices and receipts; the daily report and
 * reconciliation.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient, withDbContext } from '@hotel/database';
import { testDatabaseUrls } from '@hotel/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SandboxProvider } from '../src/modules/finance/payments/sandbox.provider.js';
import { Mailbox, startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let john: TestClient;
let reception: TestClient;
let sandbox: SandboxProvider;
let folioId: string;
let folioUrl: string;

const MNL = () => ctx.world.abc.properties.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
const inv = () => ctx.world.inventory.MNL;
const idem = () => ({ 'idempotency-key': `test-${randomUUID()}` });
const folio = async () => (await reception.get(folioUrl)).body;

async function checkedInGuest(roomNumber: string, email: string) {
  const booking = await reception.request(
    'POST',
    `${base()}/reservations`,
    {
      source: 'DIRECT',
      booker: { newGuest: { firstName: 'Paz', lastName: 'Payer', email } },
      rooms: [
        {
          roomTypeId: inv().roomTypes.STD,
          ratePlanId: inv().ratePlans.BAR,
          arrivalDate: '2026-10-01',
          departureDate: '2026-10-03',
          adults: 1,
          roomId: inv().rooms[roomNumber],
        },
      ],
    },
    idem(),
  );
  expect(booking.status, JSON.stringify(booking.body)).toBe(201);
  const line = `${base()}/reservations/${booking.body.id}/rooms/${booking.body.rooms[0].id}`;
  expect((await reception.request('POST', `${line}/check-in`)).status).toBe(200);
  const f = (await reception.get(`${line}/folio`)).body;
  return { bookingId: booking.body.id as string, folioId: f.id as string };
}

async function charge(target: string, department: string, amountMinor: number, client = reception) {
  const res = await client.request(
    'POST',
    `${base()}/folios/${target}/charges`,
    { department, description: `${department} test`, amountMinor },
    idem(),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** Follows the sandbox's hosted page like a payer's browser would. */
async function payAtSandbox(checkoutUrl: string, outcome: 'pay' | 'decline', method = 'CARD') {
  const path = new URL(checkoutUrl).pathname;
  const page = await ctx.app.inject({ method: 'GET', url: path });
  expect(page.statusCode).toBe(200);
  return ctx.app.inject({
    method: 'POST',
    url: `${path}/${outcome}`,
    payload: `method=${method}`,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: new URL(checkoutUrl).origin,
    },
  });
}

const webhook = (event: { rawBody: string; headers: Record<string, string> }) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/payments/sandbox',
    payload: event.rawBody,
    headers: event.headers,
  });

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  john = await TestClient.as(ctx.app, 'john.gm@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  sandbox = new SandboxProvider(ctx.env);
  ({ folioId } = await checkedInGuest('101', 'payer@example.test'));
  folioUrl = `${base()}/folios/${folioId}`;
  await charge(folioId, 'ROOM', 350_000);
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('online payments', () => {
  let reference: string;
  let paymentId: string;

  it('a payment link settles the folio only when the signed webhook arrives', async () => {
    expect(
      (await reception.request('POST', `${folioUrl}/payment-links`, { amountMinor: 100_000 }))
        .status,
    ).toBe(400);
    const link = await reception.request(
      'POST',
      `${folioUrl}/payment-links`,
      { amountMinor: 100_000 },
      idem(),
    );
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    expect(link.body).toMatchObject({
      status: 'PENDING',
      provider: 'sandbox',
      amountMinor: 100_000,
    });
    expect(link.body.checkoutUrl).toMatch(/\/api\/v1\/sandbox-gateway\/checkout\/sbx_[0-9a-f]+$/);
    reference = new URL(link.body.checkoutUrl).pathname.split('/').at(-1)!;
    expect((await folio()).balanceMinor).toBe(350_000);

    const paid = await payAtSandbox(link.body.checkoutUrl, 'pay', 'EWALLET');
    expect(paid.statusCode).toBe(303);
    expect(paid.headers.location).toBe(`${ctx.env.APP_PUBLIC_URL}/p/${MNL()}/folios/${folioId}`);

    const after = await folio();
    expect(after.balanceMinor).toBe(250_000);
    const payment = after.payments.find(
      (p: { provider: string | null }) => p.provider === 'sandbox',
    );
    expect(payment).toMatchObject({
      method: 'EWALLET',
      amountMinor: 100_000,
      reference,
      refundedMinor: 0,
    });
    paymentId = payment.id;
    const intents = await reception.get(`${folioUrl}/payment-intents`);
    expect(intents.body.items[0]).toMatchObject({
      status: 'SUCCEEDED',
      paymentId,
      checkoutUrl: null,
    });
  });

  it('redelivered, replayed and forged webhooks change nothing', async () => {
    const event = sandbox.event({
      type: 'payment.succeeded',
      reference,
      amountMinor: 100_000,
      currency: 'PHP',
    });
    const first = await webhook(event);
    expect(first.statusCode).toBe(200);
    expect(first.json().outcome).toBe('ignored'); // already applied
    expect((await webhook(event)).json().outcome).toBe('duplicate');

    const forged = {
      ...event,
      headers: {
        ...event.headers,
        'sandbox-signature': event.headers['sandbox-signature']!.replace(
          /v1=[0-9a-f]+/,
          `v1=${'0'.repeat(64)}`,
        ),
      },
    };
    expect((await webhook(forged)).statusCode).toBe(400);
    const stale = sandbox.sign(event.rawBody, Math.floor(Date.now() / 1000) - 3600);
    expect(
      (await webhook({ ...event, headers: { ...event.headers, 'sandbox-signature': stale } }))
        .statusCode,
    ).toBe(400);
    expect((await folio()).balanceMinor).toBe(250_000);
    expect(
      (await folio()).payments.filter((p: { provider: string | null }) => p.provider === 'sandbox'),
    ).toHaveLength(1);
  });

  it('a declined payment leaves the balance; a wrong amount is flagged, not posted', async () => {
    const declined = await reception.request(
      'POST',
      `${folioUrl}/payment-links`,
      { amountMinor: 50_000 },
      idem(),
    );
    expect((await payAtSandbox(declined.body.checkoutUrl, 'decline')).statusCode).toBe(303);
    const odd = await reception.request(
      'POST',
      `${folioUrl}/payment-links`,
      { amountMinor: 70_000 },
      idem(),
    );
    const oddRef = new URL(odd.body.checkoutUrl).pathname.split('/').at(-1)!;
    const mismatch = await webhook(
      sandbox.event({
        type: 'payment.succeeded',
        reference: oddRef,
        amountMinor: 7_000,
        currency: 'PHP',
      }),
    );
    expect(mismatch.statusCode).toBe(200);
    expect((await folio()).balanceMinor).toBe(250_000);
    const intents = (await reception.get(`${folioUrl}/payment-intents`)).body.items;
    expect(intents.find((i: { id: string }) => i.id === declined.body.id)).toMatchObject({
      status: 'FAILED',
    });
    expect(intents.find((i: { id: string }) => i.id === odd.body.id)).toMatchObject({
      status: 'SUCCEEDED',
      needsAttention: true,
      paymentId: null,
    });
  });

  it('the guest pays their own balance from the portal', async () => {
    const { folioId: guestFolio, bookingId } = await checkedInGuest(
      '102',
      'portal-payer@example.test',
    );
    await charge(guestFolio, 'ROOM', 350_000);
    expect(
      (await reception.request('POST', `${base()}/reservations/${bookingId}/guest-portal-link`))
        .status,
    ).toBe(204);
    const mail = await ctx.mailbox.latestFor('portal-payer@example.test', 'guest-portal-link');
    const cookieJar: { cookie?: string; csrf?: string } = {};
    const guest = async (
      method: 'GET' | 'POST',
      url: string,
      payload?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const res = await ctx.app.inject({
        method,
        url: `/api/v1${url}`,
        ...(payload === undefined ? {} : { payload: payload as object }),
        headers: {
          origin: 'http://localhost:43200',
          ...(cookieJar.cookie ? { cookie: cookieJar.cookie } : {}),
          ...(cookieJar.csrf && method !== 'GET' ? { 'x-csrf-token': cookieJar.csrf } : {}),
          ...headers,
        },
      });
      const c = res.cookies.find((x) => x.name === 'hotel_guest');
      if (c) cookieJar.cookie = `hotel_guest=${c.value}`;
      const body = res.body ? JSON.parse(res.body) : null;
      if (body?.csrfToken) cookieJar.csrf = body.csrfToken;
      return { status: res.statusCode, body };
    };
    await guest('POST', '/guest/session', {
      token: Mailbox.tokenFrom((mail!.data as { portalUrl: string }).portalUrl),
    });
    await guest('POST', '/guest/verification');
    const code = (
      (await ctx.mailbox.latestFor('portal-payer@example.test', 'guest-verification-code'))!
        .data as { code: string }
    ).code;
    expect((await guest('POST', '/guest/verification/confirm', { code })).status).toBe(200);

    expect((await guest('POST', '/guest/payments', { amountMinor: 999_999 }, idem())).status).toBe(
      400,
    );
    const intent = await guest('POST', '/guest/payments', {}, idem());
    expect(intent.status, JSON.stringify(intent.body)).toBe(201);
    expect(intent.body.amountMinor).toBe(350_000);
    const paid = await payAtSandbox(intent.body.checkoutUrl, 'pay');
    expect(paid.headers.location).toBe(
      `${ctx.env.GUEST_PUBLIC_URL}/stay?payment=${intent.body.id}`,
    );
    expect((await guest('GET', '/guest/bill')).body.balanceMinor).toBe(0);
  });
});

describe('refunds', () => {
  it('are capped at what is left, race-safe, sensitive, and reach the folio', async () => {
    const payment = (await folio()).payments.find(
      (p: { provider: string | null }) => p.provider === 'sandbox',
    );
    const url = `${base()}/payments/${payment.id}/refunds`;
    expect(
      (await reception.request('POST', url, { amountMinor: 10_000, reason: 'Goodwill' }, idem()))
        .status,
    ).toBe(403);
    // John holds payment.refund but has no second factor: sensitive permissions need one.
    expect(
      (await john.request('POST', url, { amountMinor: 10_000, reason: 'Goodwill' }, idem())).status,
    ).toBe(403);

    const first = await admin.request(
      'POST',
      url,
      { amountMinor: 30_000, reason: 'Late check-in credit' },
      idem(),
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({
      status: 'SUCCEEDED',
      method: 'EWALLET',
      amountMinor: 30_000,
    });
    // 70,000 left: two concurrent 40,000 refunds cannot both pass.
    const [a, b] = await Promise.all([
      admin.request('POST', url, { amountMinor: 40_000, reason: 'Race A' }, idem()),
      admin.request('POST', url, { amountMinor: 40_000, reason: 'Race B' }, idem()),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.code).toBe('REFUND_EXCEEDS_PAYMENT');

    const after = await folio();
    expect(after.payments.find((p: { id: string }) => p.id === payment.id).refundedMinor).toBe(
      70_000,
    );
    expect(
      after.lines
        .filter((l: { type: string }) => l.type === 'REFUND')
        .map((l: { amountMinor: number }) => l.amountMinor)
        .sort(),
    ).toEqual([30_000, 40_000]);
    expect(after.balanceMinor).toBe(250_000 + 70_000);
    expect((await admin.get(url)).body.items).toHaveLength(2);
  });
});

describe('cashier shifts', () => {
  it('cash needs an open shift; closing reconciles the drawer', async () => {
    const cash = (amountMinor: number) =>
      reception.request('POST', `${folioUrl}/payments`, { method: 'CASH', amountMinor }, idem());
    expect((await cash(20_000)).body.code).toBe('CASHIER_SHIFT_REQUIRED');
    const opened = await reception.request('POST', `${base()}/cashier/shift`, {
      openingFloatMinor: 500_000,
    });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    expect(
      (await reception.request('POST', `${base()}/cashier/shift`, { openingFloatMinor: 1 })).status,
    ).toBe(409);
    expect((await cash(20_000)).status).toBe(200);
    const cashPayment = (await folio()).payments.find(
      (p: { method: string }) => p.method === 'CASH',
    );

    // A cash refund comes out of the refunder's own drawer.
    const refundUrl = `${base()}/payments/${cashPayment.id}/refunds`;
    expect(
      (await admin.request('POST', refundUrl, { amountMinor: 5_000, reason: 'Change' }, idem()))
        .body.code,
    ).toBe('CASHIER_SHIFT_REQUIRED');
    const adminShift = await admin.request('POST', `${base()}/cashier/shift`, {
      openingFloatMinor: 100_000,
    });
    expect(
      (await admin.request('POST', refundUrl, { amountMinor: 5_000, reason: 'Change' }, idem()))
        .status,
    ).toBe(201);

    const current = (await reception.get(`${base()}/cashier/shift`)).body.shift;
    expect(current).toMatchObject({
      cashInMinor: 20_000,
      cashOutMinor: 0,
      expectedCashMinor: 520_000,
    });
    const closeUrl = `${base()}/cashier/shifts/${current.id}/close`;
    expect(
      (
        await admin.request(
          'POST',
          closeUrl,
          { countedCashMinor: 1 },
          { 'if-match': `W/"${current.version}"` },
        )
      ).status,
    ).toBe(403);
    const closed = await reception.request(
      'POST',
      closeUrl,
      { countedCashMinor: 519_500, notes: 'Short 5 pesos' },
      { 'if-match': `W/"${current.version}"` },
    );
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body).toMatchObject({
      status: 'CLOSED',
      expectedCashMinor: 520_000,
      countedCashMinor: 519_500,
      varianceMinor: -500,
    });

    const adminClosed = await admin.request(
      'POST',
      `${base()}/cashier/shifts/${adminShift.body.id}/close`,
      { countedCashMinor: 95_000 },
      { 'if-match': 'W/"1"' },
    );
    expect(adminClosed.body).toMatchObject({
      cashOutMinor: 5_000,
      expectedCashMinor: 95_000,
      varianceMinor: 0,
    });
    const list = await john.get(`${base()}/cashier/shifts`);
    expect(list.body.items.length).toBeGreaterThanOrEqual(2);
    expect((await reception.get(`${base()}/cashier/shifts`)).status).toBe(403);
  });
});

describe('accounts, routing and transfers', () => {
  let accountId: string;

  it('routes charges of chosen departments to a company account', async () => {
    const account = await admin.request('POST', `${base()}/accounts`, { label: 'Acme Corp' });
    expect(account.status, JSON.stringify(account.body)).toBe(201);
    expect(account.body).toMatchObject({
      label: 'Acme Corp',
      reservationRoomId: null,
      balanceMinor: 0,
    });
    accountId = account.body.id;
    expect((await reception.request('POST', `${base()}/accounts`, { label: 'Nope' })).status).toBe(
      403,
    );

    const rule = await admin.request('POST', `${folioUrl}/routing-rules`, {
      targetFolioId: accountId,
      departments: ['ROOM'],
    });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    expect(
      (
        await admin.request('POST', `${folioUrl}/routing-rules`, {
          targetFolioId: accountId,
          departments: ['ROOM', 'FNB'],
        })
      ).status,
    ).toBe(409);

    const before = (await folio()).balanceMinor;
    await charge(folioId, 'ROOM', 350_000);
    await charge(folioId, 'MINIBAR', 5_600);
    expect((await folio()).balanceMinor).toBe(before + 5_600);
    const acme = (await reception.get(`${base()}/folios/${accountId}`)).body;
    expect(acme.balanceMinor).toBe(350_000);
    expect(acme.lines.find((l: { type: string }) => l.type === 'CHARGE').description).toContain(
      'ROOM test (',
    );
    expect((await admin.get(`${base()}/accounts`)).body.items).toContainEqual(
      expect.objectContaining({ id: accountId, balanceMinor: 350_000 }),
    );

    await admin.request('DELETE', `${base()}/routing-rules/${rule.body.items[0].id}`);
    expect((await admin.get(`${folioUrl}/routing-rules`)).body.items).toEqual([]);
  });

  it('moves a charge and its taxes once; a moved charge cannot be voided', async () => {
    const guestFolio = await folio();
    const minibar = guestFolio.lines.find(
      (l: { type: string; department: string; reversed: boolean }) =>
        l.type === 'CHARGE' && l.department === 'MINIBAR' && !l.reversed,
    );
    const move = () =>
      admin.request('POST', `${folioUrl}/transfers`, {
        targetFolioId: accountId,
        lineIds: [minibar.id],
        reason: 'Company pays',
      });
    const moved = await move();
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.balanceMinor).toBe(guestFolio.balanceMinor - 5_600);
    expect((await reception.get(`${base()}/folios/${accountId}`)).body.balanceMinor).toBe(
      350_000 + 5_600,
    );
    expect((await move()).status).toBe(409);
    const voided = await reception.request('POST', `${folioUrl}/lines/${minibar.id}/void`, {
      reason: 'Oops',
    });
    expect(voided.status).toBe(409);
  });
});

describe('invoices and receipts', () => {
  it('are numbered without gaps, one receipt per payment, and never change', async () => {
    const issue = (body: object) => reception.request('POST', `${folioUrl}/documents`, body);
    const first = await issue({ type: 'INVOICE' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.documentNo).toBe('INV-000001');
    expect(first.body.content.billTo).toBe('Paz Payer');
    expect(first.body.content.taxes[0]).toMatchObject({ code: expect.any(String) });
    expect((await issue({ type: 'INVOICE' })).body.documentNo).toBe('INV-000002');

    const payment = (await folio()).payments.find((p: { method: string }) => p.method === 'CASH');
    // A failed issue does not consume a number.
    expect((await issue({ type: 'RECEIPT', paymentId: randomUUID() })).status).toBe(400);
    const receipt = await issue({ type: 'RECEIPT', paymentId: payment.id });
    expect(receipt.body).toMatchObject({ documentNo: 'RCT-000001', totalMinor: 20_000 });
    expect(receipt.body.content.payment).toMatchObject({ method: 'CASH', amountMinor: 20_000 });
    expect((await issue({ type: 'RECEIPT', paymentId: payment.id })).body.id).toBe(receipt.body.id);
    expect((await reception.get(`${folioUrl}/documents`)).body.items).toHaveLength(3);
    expect((await john.request('POST', `${folioUrl}/documents`, { type: 'INVOICE' })).status).toBe(
      201,
    );

    const app = createPrismaClient({ connectionString: testDatabaseUrls().app, maxConnections: 1 });
    try {
      const org = { organizationId: ctx.world.abc.organizationId, identityId: null };
      await expect(
        withDbContext(app, org, (tx) => tx.folioDocument.updateMany({ data: { totalMinor: 1n } })),
      ).rejects.toThrow(/permission denied|append-only/);
    } finally {
      await app.$disconnect();
    }
  });
});

describe('reports', () => {
  it('summarize the business day and reconcile the ledger', async () => {
    const report = await john.get(`${base()}/reports/daily`);
    expect(report.status, JSON.stringify(report.body)).toBe(200);
    expect(report.body.businessDate).toBe('2026-10-01');
    const room = report.body.revenue.find((r: { department: string }) => r.department === 'ROOM');
    expect(room.netMinor).toBeGreaterThan(0);
    expect(report.body.taxes.length).toBeGreaterThan(0);
    expect(report.body.payments.map((p: { method: string }) => p.method)).toEqual(
      expect.arrayContaining(['CASH', 'CARD', 'EWALLET']),
    );
    expect(report.body.totals.refundsMinor).toBe(75_000);
    expect((await reception.get(`${base()}/reports/daily`)).status).toBe(403);

    const reconciliation = await john.get(`${base()}/reports/reconciliation`);
    expect(reconciliation.status).toBe(200);
    const codes = reconciliation.body.issues.map((i: { code: string }) => i.code);
    expect(codes).toContain('UNAPPLIED_ONLINE_PAYMENT'); // the mismatched amount above
    expect(codes).not.toContain('FOLIO_BALANCE_MISMATCH');
    expect(codes).not.toContain('PAYMENT_WITHOUT_LINE');
  });
});
