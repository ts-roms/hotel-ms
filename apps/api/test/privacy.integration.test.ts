/**
 * Privacy tools, CSV import and images (ADR-0030): data export and anonymization for guests
 * and employees, previewed CSV imports of guests and rooms, and hotel and menu photos that
 * are re-encoded without metadata and served only to the right people.
 */
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GuestClient, Mailbox, startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let john: TestClient;
let reception: TestClient;
let hk: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const CEB = () => ctx.world.abc.properties.CEB;
const base = (p = MNL()) => `/api/v1/properties/${p}`;
const inv = () => ctx.world.inventory.MNL;
const F = () => ctx.world.fnb.MNL;
const csv = (client: TestClient, url: string, text: string) =>
  client.request('POST', url, Buffer.from(text), { 'content-type': 'text/csv' });

/** A JPEG with a GPS position in its EXIF block, as phones write them. */
async function photoWithLocation(): Promise<Buffer> {
  return sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#3366aa' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'PhoneCo', Model: 'Snap 9' }, IFD3: { GPSLatitudeRef: 'N' } })
    .toBuffer();
}

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  john = await TestClient.as(ctx.app, 'john.gm@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('CSV import', () => {
  it('previews rooms: nothing is committable while a row has an error', async () => {
    const url = `${base()}/imports/rooms/preview`;
    const res = await csv(
      admin,
      url,
      'number,room_type,notes\n301,STD,Garden view\n101,STD,\n301,DLX,\n30 2,STD,\n303,XYZ,\n',
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'rooms',
      totalRows: 5,
      newRows: 1,
      duplicateRows: 2,
      errorRows: 2,
      token: '',
    });
    expect(res.body.errors).toEqual([
      { row: 5, column: 'number', message: 'Letters, digits and - (1-10 characters)' },
      { row: 6, column: 'room_type', message: 'No room type XYZ here' },
    ]);
    expect(res.body.sample.map((s: { status: string }) => s.status)).toEqual([
      'NEW',
      'DUPLICATE',
      'DUPLICATE',
      'ERROR',
      'ERROR',
    ]);
  });

  it('commits exactly the previewed rooms, once', async () => {
    const preview = await csv(
      admin,
      `${base()}/imports/rooms/preview`,
      '﻿Number*,Room_Type*\r\n401,STD\r\n402,dlx\r\n101,STD\r\n',
    );
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({ newRows: 2, duplicateRows: 1, errorRows: 0 });
    const token = preview.body.token as string;
    expect(token.length).toBeGreaterThan(10);

    // Only whoever previewed can commit, and only at that property.
    expect(
      (await admin.request('POST', `${base(CEB())}/imports/rooms/commit`, { token })).status,
    ).toBe(410);
    const commit = await admin.request('POST', `${base()}/imports/rooms/commit`, { token });
    expect(commit.status, JSON.stringify(commit.body)).toBe(200);
    expect(commit.body).toEqual({ kind: 'rooms', created: 2, skipped: 1 });
    expect((await admin.request('POST', `${base()}/imports/rooms/commit`, { token })).status).toBe(
      410,
    );
    const rooms = (await admin.get(`${base()}/rooms`)).body as { number: string }[];
    expect(rooms.map((r) => r.number)).toEqual(expect.arrayContaining(['401', '402']));
  });

  it('checks the header, the file and the permission', async () => {
    const url = `${base()}/imports/rooms/preview`;
    const missing = await csv(admin, url, 'number\n501\n');
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain('Missing column room_type');
    expect((await csv(admin, url, 'number,room_type,colour\n501,STD,red\n')).status).toBe(400);
    expect((await csv(admin, url, 'number,room_type\n"501,STD\n')).status).toBe(400);
    expect((await csv(admin, url, '')).status).toBe(400);
    expect((await csv(hk, url, 'number,room_type\n501,STD\n')).status).toBe(403);
  });

  it('imports guests, skipping ones already known by email', async () => {
    const known = `known-${randomUUID().slice(0, 6)}@example.test`;
    const created = await reception.request('POST', `${base()}/guests`, {
      firstName: 'Kim',
      lastName: 'Known',
      email: known,
    });
    expect(created.status).toBe(201);
    const fresh = `new-${randomUUID().slice(0, 6)}@example.test`;
    const url = `${base()}/imports/guests/preview`;
    const bad = await csv(
      reception,
      url,
      `first_name,last_name,email\nAna,Bad,not-an-email\n,Nameless,\n`,
    );
    expect(bad.body).toMatchObject({ errorRows: 2 });
    expect(bad.body.errors.map((e: { column: string }) => e.column)).toEqual([
      'email',
      'first_name',
    ]);

    const preview = await csv(
      reception,
      url,
      [
        'first_name,last_name,email,phone,country_code,notes',
        `Nora,New,${fresh},+63 917 000 0000,ph,"Prefers a quiet room, high floor"`,
        `Kim,Known,${known.toUpperCase()},,,`,
        `Nora,Twice,${fresh},,,`,
        'Walk,In,,,,',
      ].join('\n'),
    );
    expect(preview.body).toMatchObject({ newRows: 2, duplicateRows: 2, errorRows: 0 });
    const commit = await reception.request('POST', `${base()}/imports/guests/commit`, {
      token: preview.body.token,
    });
    expect(commit.body).toEqual({ kind: 'guests', created: 2, skipped: 2 });
    const found = await reception.get(`/api/v1/guests?q=${encodeURIComponent(fresh)}`);
    expect(found.body[0]).toMatchObject({
      firstName: 'Nora',
      countryCode: 'PH',
      notes: 'Prefers a quiet room, high floor',
    });
  });
});

describe('images', () => {
  let imageId: string;

  it('re-encodes hotel photos to WebP without metadata, within 1600 px', async () => {
    const url = `${base()}/images?caption=${encodeURIComponent('Pool at sunset')}`;
    const res = await admin.request('POST', url, await photoWithLocation(), {
      'content-type': 'image/jpeg',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.items).toEqual([
      expect.objectContaining({
        caption: 'Pool at sunset',
        width: 1600,
        height: 800,
        sortOrder: 0,
      }),
    ]);
    imageId = res.body.items[0].id;

    const file = await ctx.app.inject({
      method: 'GET',
      url: `${base()}/images/${imageId}/content`,
      headers: { cookie: john.cookieHeader },
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/webp');
    const meta = await sharp(file.rawPayload).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();

    const again = await ctx.app.inject({
      method: 'GET',
      url: `${base()}/images/${imageId}/content`,
      headers: { cookie: john.cookieHeader, 'if-none-match': String(file.headers.etag) },
    });
    expect(again.statusCode).toBe(304);
  });

  it('refuses what is not an image, and staff without the permission', async () => {
    const url = `${base()}/images`;
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('<script>alert(1)</script>'),
    ]);
    expect((await admin.request('POST', url, fake, { 'content-type': 'image/png' })).status).toBe(
      415,
    );
    expect(
      (await admin.request('POST', url, Buffer.from('%PDF-1.7'), { 'content-type': 'image/png' }))
        .status,
    ).toBe(415);
    expect(
      (
        await reception.request('POST', url, await photoWithLocation(), {
          'content-type': 'image/jpeg',
        })
      ).status,
    ).toBe(403);
    const renamed = await admin.request('PATCH', `${url}/${imageId}`, { caption: 'The pool' });
    expect(renamed.body.items[0].caption).toBe('The pool');
    // Not reachable through another property.
    expect((await admin.get(`${base(CEB())}/images/${imageId}/content`)).status).toBe(404);
  });

  it('shows guests their hotel and menu photos', async () => {
    const item = F().items.Tapsilog!;
    const set = await admin.request(
      'PUT',
      `${base()}/menu-items/${item}/image`,
      await photoWithLocation(),
      {
        'content-type': 'image/jpeg',
      },
    );
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    type MenuBody = { categories: { items: { id: string; imageVersion: string | null }[] }[] };
    const itemIn = (menu: MenuBody) =>
      menu.categories.flatMap((c) => c.items).find((i) => i.id === item);
    const menu = await admin.get(`${base()}/outlets/${F().outlets.IRD}/menu`);
    expect(itemIn(menu.body)?.imageVersion).toBe(set.body.imageVersion);

    // A guest of Manila.
    const email = `img-${randomUUID().slice(0, 6)}@example.test`;
    const booking = await reception.request(
      'POST',
      `${base()}/reservations`,
      {
        source: 'DIRECT',
        booker: { newGuest: { firstName: 'Ivy', lastName: 'Image', email } },
        rooms: [
          {
            roomTypeId: inv().roomTypes.STD,
            ratePlanId: inv().ratePlans.BAR,
            arrivalDate: '2026-11-20',
            departureDate: '2026-11-21',
            adults: 1,
          },
        ],
      },
      { 'idempotency-key': `test-${randomUUID()}` },
    );
    await reception.request('POST', `${base()}/reservations/${booking.body.id}/guest-portal-link`);
    const token = Mailbox.tokenFrom(
      ((await ctx.mailbox.latestFor(email, 'guest-portal-link'))!.data as { portalUrl: string })
        .portalUrl,
    );
    const guest = new GuestClient(ctx.app);
    await guest.request('POST', '/guest/session', { token });
    const info = await guest.request('GET', '/guest/hotel-info');
    expect(info.body.images).toEqual([
      expect.objectContaining({ id: imageId, caption: 'The pool' }),
    ]);
    expect((await guest.request('GET', `/guest/hotel-images/${imageId}`)).status).toBe(200);
    expect((await guest.request('GET', `/guest/menu-items/${item}/image`)).status).toBe(200);
    const guestMenus = (await guest.request('GET', '/guest/menus')).body.items as MenuBody[];
    expect(guestMenus.map(itemIn).find(Boolean)?.imageVersion).toBe(set.body.imageVersion);
    expect((await guest.request('GET', `/guest/hotel-images/${randomUUID()}`)).status).toBe(404);

    expect((await admin.request('DELETE', `${base()}/menu-items/${item}/image`)).status).toBe(204);
    expect((await guest.request('GET', `/guest/menu-items/${item}/image`)).status).toBe(404);
    expect((await admin.request('DELETE', `${base()}/images/${imageId}`)).status).toBe(204);
    expect((await guest.request('GET', '/guest/hotel-info')).body.images).toEqual([]);
  });
});

describe('guest data requests', () => {
  it('export everything about a guest, for privacy managers with two-step verification', async () => {
    const guests = await reception.get('/api/v1/guests?q=Nora');
    const nora = guests.body[0];
    expect((await john.get(`/api/v1/guests/${nora.id}/export`)).status).toBe(403);
    expect((await reception.get(`/api/v1/guests/${nora.id}/export`)).status).toBe(403);
    const res = await admin.get(`/api/v1/guests/${nora.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="guest-${nora.id}.json"; filename*=UTF-8''guest-${nora.id}.json`,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      subject: 'guest',
      profile: { firstName: 'Nora', lastName: 'New', notes: 'Prefers a quiet room, high floor' },
      stays: [],
    });
  });

  it('anonymize a guest once no stay is upcoming or current', async () => {
    // Ivy has an upcoming stay.
    const ivy = (await reception.get('/api/v1/guests?q=Ivy')).body[0];
    const refused = await admin.request('POST', `/api/v1/guests/${ivy.id}/anonymize`, {
      reason: 'Guest asked to be forgotten',
    });
    expect(refused.status).toBe(409);

    const nora = (await reception.get('/api/v1/guests?q=Nora')).body[0];
    expect(
      (await admin.request('POST', `/api/v1/guests/${nora.id}/anonymize`, { reason: 'x' })).status,
    ).toBe(400);
    const res = await admin.request('POST', `/api/v1/guests/${nora.id}/anonymize`, {
      reason: 'Guest asked to be forgotten (email 2026-10-04)',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.summary).toMatchObject({ profile: 1 });
    // Archived: gone from the guest screens; what remains names nobody.
    expect((await admin.get(`/api/v1/guests/${nora.id}`)).status).toBe(404);
    const after = await admin.get(`/api/v1/guests/${nora.id}/export`);
    expect(after.body.profile).toMatchObject({
      firstName: 'Anonymized',
      lastName: 'Guest',
      email: null,
      phone: null,
      countryCode: null,
      notes: '',
    });
    expect(after.body.profile.archivedAt).not.toBeNull();
    expect(
      (
        await admin.request('POST', `/api/v1/guests/${nora.id}/anonymize`, {
          reason: 'again, please',
        })
      ).status,
    ).toBe(409);
    // The audit log keeps the reason, not the data.
    const audit = await admin.get(`/api/v1/audit-logs?entityType=guest&entityId=${nora.id}`);
    const entry = audit.body.items.find(
      (e: { action: string }) => e.action === 'privacy.guest_anonymized',
    );
    expect(JSON.stringify(entry)).toContain('Guest asked to be forgotten');
    expect(JSON.stringify(entry)).not.toContain('Nora');
  });
});

describe('employee data requests', () => {
  const E = (no: string) => `/api/v1/employees/${ctx.world.hr.abc.employees[no]}`;

  it('export an employee, and anonymize only someone who has left', async () => {
    const exported = await admin.get(`${E('E006')}/export`);
    expect(exported.status).toBe(200);
    expect(exported.body).toMatchObject({
      subject: 'employee',
      profile: { employeeNo: 'E006', firstName: 'Carlo', lastName: 'Cruz' },
    });
    expect(exported.body.assignments.length).toBeGreaterThan(0);

    const active = await admin.request('POST', `${E('E006')}/anonymize`, {
      reason: 'Former employee asked for erasure',
    });
    expect(active.status).toBe(409);

    const terminated = await admin.request('POST', `${E('E006')}/terminate`, {
      terminatedOn: '2026-10-01',
    });
    expect(terminated.status, JSON.stringify(terminated.body)).toBe(200);
    const res = await admin.request('POST', `${E('E006')}/anonymize`, {
      reason: 'Former employee asked for erasure',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await admin.get(E('E006'));
    expect(after.body).toMatchObject({
      firstName: 'Former',
      lastName: 'employee E006',
      preferredName: null,
      workEmail: null,
      membershipId: null,
      personal: {
        birthDate: null,
        personalEmail: null,
        personalPhone: null,
        emergencyContact: null,
      },
    });
  });
});
