/**
 * F&B (blueprint §14): menus with modifiers, guest room-service ordering, the kitchen
 * state machine, the realtime kitchen stream, and the phase exit criterion: a room-service
 * order appears on the guest folio exactly once (and a cancellation reverses it).
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient, withDbContext } from '@hotel/database';
import { testDatabaseUrls } from '@hotel/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GuestClient,
  guestSession,
  startTestApp,
  type TestContext,
  TestClient,
} from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let john: TestClient;
let reception: TestClient;
let kitchen: TestClient;
let runner: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
const F = () => ctx.world.fnb.MNL;
const inv = () => ctx.world.inventory.MNL;
const idem = () => ({ 'idempotency-key': `test-${randomUUID()}` });
const ifMatch = (version: number) => ({ 'if-match': `W/"${version}"` });

/** An in-house STD guest in `roomNumber` with a verified portal session. */
async function inHouseGuest(roomNumber: string) {
  const email = `fnb-${randomUUID().slice(0, 8)}@example.test`;
  const booking = await reception.request(
    'POST',
    `${base()}/reservations`,
    {
      source: 'DIRECT',
      booker: { newGuest: { firstName: 'Olga', lastName: 'Order', email } },
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
  const guest = await guestSession(ctx, reception, {
    propertyId: MNL(),
    reservationId: booking.body.id,
    email,
  });
  const folio = await reception.get(`${line}/folio`);
  return { guest, folioId: folio.body.id as string, line };
}

const sandwich = (side = 'Fries') => ({
  menuItemId: F().items['Club Sandwich']!,
  quantity: 2,
  modifierIds: [F().modifiers[side]!, F().modifiers['Extra bacon']!],
  notes: 'No mayo',
});

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  john = await TestClient.as(ctx.app, 'john.gm@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  kitchen = await TestClient.as(ctx.app, 'kitchen@abc.test');
  runner = await TestClient.as(ctx.app, 'runner@abc.test');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('menus', () => {
  it('are managed by managers; the kitchen only marks items sold out', async () => {
    const outlets = await kitchen.get(`${base()}/outlets`);
    expect(outlets.body.items.map((o: { code: string }) => o.code).sort()).toEqual(['CAFE', 'IRD']);
    const menu = await kitchen.get(`${base()}/outlets/${F().outlets.IRD}/menu`);
    expect(menu.body.categories.map((c: { name: string }) => c.name)).toEqual([
      'Breakfast',
      'Mains',
      'Drinks',
    ]);

    const item = {
      categoryId: menu.body.categories[2].id,
      name: 'Calamansi Juice',
      priceMinor: 9_000,
    };
    expect(
      (await kitchen.request('POST', `${base()}/outlets/${F().outlets.IRD}/menu/items`, item))
        .status,
    ).toBe(403);
    const created = await john.request(
      'POST',
      `${base()}/outlets/${F().outlets.IRD}/menu/items`,
      item,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const soldOut = await kitchen.request(
      'PUT',
      `${base()}/menu-items/${created.body.id}/availability`,
      { available: false },
    );
    expect(soldOut.body.available).toBe(false);
    expect(
      (
        await reception.request('PUT', `${base()}/menu-items/${created.body.id}/availability`, {
          available: true,
        })
      ).status,
    ).toBe(403);
  });
});

describe('room service from the guest portal', () => {
  let guest: GuestClient;
  let folioId: string;
  let orderId: string;

  beforeAll(async () => {
    ({ guest, folioId } = await inHouseGuest('101'));
  });

  it('shows only available items of room-service outlets', async () => {
    const menus = await guest.request('GET', '/guest/menus');
    expect(menus.status).toBe(200);
    expect(menus.body.items.map((m: { outlet: { code: string } }) => m.outlet.code)).toEqual([
      'IRD',
    ]);
    const names = menus.body.items[0].categories.flatMap((c: { items: { name: string }[] }) =>
      c.items.map((i) => i.name),
    );
    expect(names).toContain('Club Sandwich');
    expect(names).not.toContain('Calamansi Juice'); // sold out
    expect(menus.body.items[0].open).toBe(true);
  });

  it('prices orders from the live menu, validates options, and is idempotent', async () => {
    const order = (items: unknown[], key = `g-${randomUUID()}`) =>
      guest.request(
        'POST',
        '/guest/orders',
        { outletId: F().outlets.IRD, chargeMethod: 'ROOM_CHARGE', items },
        { 'idempotency-key': key },
      );

    expect(
      (
        await guest.request('POST', '/guest/orders', {
          outletId: F().outlets.IRD,
          chargeMethod: 'ROOM_CHARGE',
          items: [sandwich()],
        })
      ).status,
    ).toBe(400);
    const noSide = await order([{ ...sandwich(), modifierIds: [] }]);
    expect(noSide.status).toBe(400);
    expect(JSON.stringify(noSide.body)).toContain('choose 1 side');

    const key = `g-${randomUUID()}`;
    const placed = await order(
      [sandwich('Sweet potato fries'), { menuItemId: F().items.Tapsilog, quantity: 1 }],
      key,
    );
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    // (420 + 50 + 80) × 2 + 450 = ₱1,550.00; PH VAT is inside the menu prices.
    expect(placed.body).toMatchObject({
      status: 'PENDING',
      source: 'GUEST',
      roomNumber: '101',
      subtotalMinor: 155_000,
      addedTaxMinor: 0,
      totalMinor: 155_000,
      charged: false,
    });
    expect(placed.body.items[0].modifiers).toEqual([
      { name: 'Sweet potato fries', priceMinor: 5_000 },
      { name: 'Extra bacon', priceMinor: 8_000 },
    ]);
    orderId = placed.body.id;

    const replay = await order(
      [sandwich('Sweet potato fries'), { menuItemId: F().items.Tapsilog, quantity: 1 }],
      key,
    );
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(orderId);
    expect((await order([sandwich()], key)).status).toBe(422);

    // Menu changes later never touch the order.
    await john.request('PATCH', `${base()}/menu-items/${F().items['Club Sandwich']}`, {
      priceMinor: 99_000,
    });
    expect(
      (await guest.request('GET', '/guest/orders')).body.items.find(
        (o: { id: string }) => o.id === orderId,
      ).subtotalMinor,
    ).toBe(155_000);
    await john.request('PATCH', `${base()}/menu-items/${F().items['Club Sandwich']}`, {
      priceMinor: 42_000,
    });
  });

  it('goes through the kitchen once, and lands on the folio exactly once', async () => {
    const before = (await reception.get(`${base()}/folios/${folioId}`)).body.balanceMinor;
    const step = async (client: TestClient, status: string, version: number) =>
      client.request('POST', `${base()}/orders/${orderId}/status`, { status }, ifMatch(version));

    expect((await step(kitchen, 'PREPARING', 1)).status).toBe(409); // not confirmed yet
    const confirmed = await step(kitchen, 'CONFIRMED', 1);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect((await step(kitchen, 'PREPARING', 1)).status).toBe(412); // stale version
    expect((await step(kitchen, 'PREPARING', 2)).body.status).toBe('PREPARING');
    // The guest can no longer withdraw it.
    expect((await guest.request('POST', `/guest/orders/${orderId}/cancel`)).status).toBe(409);
    expect((await step(kitchen, 'READY', 3)).body.status).toBe('READY');
    expect((await step(runner, 'OUT_FOR_DELIVERY', 4)).body.status).toBe('OUT_FOR_DELIVERY');
    const delivered = await step(runner, 'DELIVERED', 5);
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    expect(delivered.body.charged).toBe(true);
    expect(delivered.body.events.map((e: { status: string }) => e.status)).toEqual([
      'PENDING',
      'CONFIRMED',
      'PREPARING',
      'READY',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ]);
    expect((await step(runner, 'DELIVERED', 6)).status).toBe(409);

    const folio = (await reception.get(`${base()}/folios/${folioId}`)).body;
    const charges = folio.lines.filter(
      (l: { description: string; type: string }) =>
        l.type === 'CHARGE' && l.description.includes(delivered.body.orderNo),
    );
    expect(charges).toHaveLength(1);
    expect(charges[0].department).toBe('FNB');
    expect(folio.balanceMinor - before).toBe(155_000);
    const bill = await guest.request('GET', '/guest/bill');
    expect(
      bill.body.lines.some((l: { description: string }) =>
        l.description.includes(delivered.body.orderNo),
      ),
    ).toBe(true);

    // Exactly once, even if the charge were attempted again at the database level.
    const app = createPrismaClient({ connectionString: testDatabaseUrls().app, maxConnections: 1 });
    try {
      const org = { organizationId: ctx.world.abc.organizationId, identityId: null };
      const rows = await withDbContext(app, org, (tx) =>
        tx.folioLine.count({ where: { sourceKey: `order:${orderId}` } }),
      );
      expect(rows).toBe(1);
      await expect(
        withDbContext(app, org, (tx) => tx.orderEvent.deleteMany({ where: { orderId } })),
      ).rejects.toThrow(/permission denied|append-only/);
    } finally {
      await app.$disconnect();
    }
  });

  it('cancelling a delivered order needs the override and reverses the charge', async () => {
    const order = (await john.get(`${base()}/orders/${orderId}`)).body;
    const cancel = (client: TestClient) =>
      client.request(
        'POST',
        `${base()}/orders/${orderId}/cancel`,
        { reason: 'Cold food' },
        ifMatch(order.version),
      );
    expect((await cancel(kitchen)).status).toBe(403);
    const before = (await reception.get(`${base()}/folios/${folioId}`)).body.balanceMinor;
    const cancelled = await cancel(john);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Cold food' });
    const folio = (await reception.get(`${base()}/folios/${folioId}`)).body;
    expect(before - folio.balanceMinor).toBe(155_000);
    expect(
      folio.lines.filter((l: { type: string }) => l.type === 'REVERSAL').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('guests withdraw pending orders; others cannot see or touch them', async () => {
    const placed = await guest.request(
      'POST',
      '/guest/orders',
      {
        outletId: F().outlets.IRD,
        chargeMethod: 'PAY_ON_DELIVERY',
        items: [{ menuItemId: F().items['Iced Tea'], quantity: 2 }],
      },
      idem(),
    );
    expect(placed.status).toBe(201);
    const { guest: neighbour } = await inHouseGuest('102');
    expect((await neighbour.request('GET', '/guest/orders')).body.items).toEqual([]);
    expect((await neighbour.request('POST', `/guest/orders/${placed.body.id}/cancel`)).status).toBe(
      404,
    );
    const withdrawn = await guest.request('POST', `/guest/orders/${placed.body.id}/cancel`);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.status).toBe('CANCELLED');
  });

  it('is off when the organization disables food ordering', async () => {
    const url = '/api/v1/organization/feature-flags/guest_food_ordering';
    expect((await admin.request('PUT', url, { enabled: false })).status).toBe(200);
    try {
      const menus = await guest.request('GET', '/guest/menus');
      expect(menus.status).toBe(403);
      expect(menus.body.code).toBe('FEATURE_DISABLED');
    } finally {
      await admin.request('PUT', url, { enabled: true });
    }
  });
});

describe('staff orders', () => {
  it('charge to occupied rooms only; outlets without room service take walk-ins', async () => {
    const vacant = await reception.request(
      'POST',
      `${base()}/orders`,
      {
        outletId: F().outlets.IRD,
        chargeMethod: 'ROOM_CHARGE',
        roomId: inv().rooms['104'],
        items: [{ menuItemId: F().items['San Miguel Beer'], quantity: 1 }],
      },
      idem(),
    );
    expect(vacant.status).toBe(409);
    const walkIn = await reception.request(
      'POST',
      `${base()}/orders`,
      { outletId: F().outlets.CAFE, chargeMethod: 'PAY_AT_OUTLET', items: [] },
      idem(),
    );
    expect(walkIn.status).toBe(400);
    const menu = await reception.get(`${base()}/outlets/${F().outlets.CAFE}/menu`);
    const tea = menu.body.categories[0].items.find((i: { name: string }) => i.name === 'Iced Tea');
    const ok = await reception.request(
      'POST',
      `${base()}/orders`,
      {
        outletId: F().outlets.CAFE,
        chargeMethod: 'PAY_AT_OUTLET',
        items: [{ menuItemId: tea.id, quantity: 3 }],
      },
      idem(),
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({
      status: 'CONFIRMED',
      source: 'STAFF',
      roomNumber: null,
      totalMinor: 36_000,
    });
    // Out for delivery is for room orders only.
    const steps = [
      ['PREPARING', 1],
      ['READY', 2],
    ] as const;
    for (const [status, version] of steps) {
      expect(
        (
          await kitchen.request(
            'POST',
            `${base()}/orders/${ok.body.id}/status`,
            { status },
            ifMatch(version),
          )
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await runner.request(
          'POST',
          `${base()}/orders/${ok.body.id}/status`,
          { status: 'OUT_FOR_DELIVERY' },
          ifMatch(3),
        )
      ).status,
    ).toBe(409);
    const served = await runner.request(
      'POST',
      `${base()}/orders/${ok.body.id}/status`,
      { status: 'DELIVERED' },
      ifMatch(3),
    );
    expect(served.body).toMatchObject({ status: 'DELIVERED', charged: false });
    // The kitchen and runners cannot take orders.
    expect(
      (
        await kitchen.request(
          'POST',
          `${base()}/orders`,
          {
            outletId: F().outlets.CAFE,
            chargeMethod: 'PAY_AT_OUTLET',
            items: [{ menuItemId: tea.id, quantity: 1 }],
          },
          idem(),
        )
      ).status,
    ).toBe(403);
  });
});

describe('kitchen stream', () => {
  it('pushes order changes to the outlet board over Server-Sent Events', async () => {
    await ctx.app.listen(0, '127.0.0.1');
    const address = (await ctx.app.getUrl()).replace('[::1]', '127.0.0.1');
    const controller = new AbortController();
    try {
      const res = await fetch(
        `${address}/api/v1/properties/${MNL()}/outlets/${F().outlets.CAFE}/orders/stream`,
        {
          headers: { cookie: kitchen.cookieHeader!, origin: 'http://localhost:43100' },
          signal: controller.signal,
        },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let received = '';
      const until = async (text: string) => {
        const deadline = Date.now() + 5_000;
        while (!received.includes(text)) {
          if (Date.now() > deadline) throw new Error(`timed out waiting for ${text}: ${received}`);
          const { value, done } = await reader.read();
          if (done) break;
          received += decoder.decode(value);
        }
      };
      await until(': connected');

      const menu = await reception.get(`${base()}/outlets/${F().outlets.CAFE}/menu`);
      const beer = menu.body.categories[0].items.find(
        (i: { name: string }) => i.name === 'San Miguel Beer',
      );
      const placed = await reception.request(
        'POST',
        `${base()}/orders`,
        {
          outletId: F().outlets.CAFE,
          chargeMethod: 'PAY_AT_OUTLET',
          items: [{ menuItemId: beer.id, quantity: 1 }],
        },
        idem(),
      );
      expect(placed.status).toBe(201);
      await until(placed.body.id);
      expect(received).toContain('event: order');
      expect(received).toContain('"status":"CONFIRMED"');

      // Another tenant cannot open this stream.
      const xyz = await TestClient.withMfa(ctx.app, 'admin@xyz.test');
      const denied = await fetch(
        `${address}/api/v1/properties/${MNL()}/outlets/${F().outlets.CAFE}/orders/stream`,
        {
          headers: { cookie: xyz.cookieHeader!, origin: 'http://localhost:43100' },
        },
      );
      expect(denied.status).toBe(404);
    } finally {
      controller.abort();
    }
  });
});
