/**
 * Lost & found (ADR-0023, operations/lost-found): items logged where they were found, held,
 * and returned or disposed of with a record.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let hk: TestClient;
let reception: TestClient;
let kitchen: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
const room = (n: string) => ctx.world.inventory.MNL.rooms[n]!;
const ifMatch = (version: number) => ({ 'if-match': `W/"${version}"` });

beforeAll(async () => {
  ctx = await startTestApp();
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  kitchen = await TestClient.as(ctx.app, 'kitchen@abc.test');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('lost & found', () => {
  it('logs items where they were found, and returns them with a record of to whom', async () => {
    const url = `${base()}/lost-found`;
    const logged = await hk.request('POST', url, {
      description: 'Black leather wallet',
      category: 'VALUABLES',
      foundLocation: 'Room 101, under the bed',
      roomId: room('101'),
      storageLocation: 'Front office safe',
    });
    expect(logged.status, JSON.stringify(logged.body)).toBe(201);
    expect(logged.body).toMatchObject({
      itemNo: expect.stringMatching(/^LF-\d{5}$/),
      status: 'HELD',
      roomNumber: '101',
      foundByName: 'Hana Housekeeper',
    });
    expect((await kitchen.get(url)).status).toBe(403);
    expect((await hk.get(`${url}?q=wallet`)).body.items).toHaveLength(1);
    expect((await hk.get(`${url}?q=umbrella`)).body.items).toHaveLength(0);

    const close = (client: TestClient, body: object, version = logged.body.version) =>
      client.request('POST', `${url}/${logged.body.id}/close`, body, ifMatch(version));
    expect((await close(hk, { status: 'RETURNED', note: 'To the guest in 101' })).status).toBe(403);
    expect((await close(reception, { status: 'RETURNED', note: 'x' })).status).toBe(400);
    const returned = await close(reception, {
      status: 'RETURNED',
      note: 'To Mr. Cruz, room 101; ID checked, described contents',
    });
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    expect(returned.body).toMatchObject({ status: 'RETURNED' });
    expect(
      (await close(reception, { status: 'DISPOSED', note: 'again' }, returned.body.version)).status,
    ).toBe(409);
    expect((await hk.get(url)).body.items).toHaveLength(0);
    expect((await hk.get(`${url}?status=CLOSED`)).body.items).toHaveLength(1);
  });
});
