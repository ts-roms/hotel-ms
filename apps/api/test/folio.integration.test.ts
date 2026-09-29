/**
 * Folio extras (ADR-0018, finance/folio): foreign cash at the property's exchange rate and
 * statutory discounts (PH senior citizen / PWD).
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient, withDbContext } from '@hotel/database';
import { testDatabaseUrls } from '@hotel/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let reception: TestClient;
let hk: TestClient;

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

/** A verified guest session for the booking (the portal link and code go to `email`). */
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
