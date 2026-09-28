/**
 * Notification center (ADR-0024): in-app notifications for staff, guest emails and SMS
 * about their booking, and daily reminders that never send twice.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationsQueue } from '../src/infrastructure/queue.js';
import { TenantJobsProcessor } from '../src/modules/jobs/tenant-jobs.processor.js';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let john: TestClient;
let maria: TestClient;
let hk: TestClient;
let reception: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
const inv = () => ctx.world.inventory.MNL;
const idem = () => ({ 'idempotency-key': `test-${randomUUID()}` });
const plusDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
let today: string;

async function book(arrivalDate: string, departureDate: string, roomNumber?: string) {
  const email = `n-${randomUUID().slice(0, 8)}@example.test`;
  const res = await reception.request(
    'POST',
    `${base()}/reservations`,
    {
      source: 'DIRECT',
      booker: {
        newGuest: { firstName: 'Nora', lastName: 'Notified', email, phone: '+63 917 123 4567' },
      },
      rooms: [
        {
          roomTypeId: inv().roomTypes.STD,
          ratePlanId: inv().ratePlans.BAR,
          arrivalDate,
          departureDate,
          adults: 1,
          ...(roomNumber ? { roomId: inv().rooms[roomNumber] } : {}),
        },
      ],
    },
    idem(),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id as string, lineId: res.body.rooms[0].id as string, email };
}

const mailsTo = async (to: string, template: string) =>
  (await ctx.mailbox.all()).filter((m) => m.to === to && m.template === template);

const runReminders = (localDate: string) =>
  ctx.app.get(TenantJobsProcessor).run({
    type: 'property.daily-reminders',
    organizationId: ctx.world.abc.organizationId,
    propertyId: MNL(),
    localDate,
  }) as Promise<{ checkIn: number; checkOut: number; birthdays: number }>;

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  john = await TestClient.withMfa(ctx.app, 'john.gm@abc.test');
  maria = await TestClient.withMfa(ctx.app, 'maria.hr@abc.test');
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  today = (await john.get(`/api/v1/properties/${MNL()}`)).body.currentBusinessDate;
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('in-app notifications', () => {
  it('tell managers about urgent problems, and each member reads only their own', async () => {
    const reported = await hk.request('POST', `${base()}/maintenance`, {
      location: 'Kitchen',
      category: 'PLUMBING',
      priority: 'URGENT',
      title: 'Burst pipe',
      description: 'Water on the floor',
    });
    expect(reported.status).toBe(201);

    const inbox = await john.get('/api/v1/me/notifications');
    expect(inbox.status).toBe(200);
    const urgent = inbox.body.items.find((n: { kind: string }) => n.kind === 'MAINTENANCE_URGENT');
    expect(urgent).toMatchObject({
      title: 'Urgent: Burst pipe',
      body: 'Water on the floor',
      link: `/p/${MNL()}/maintenance`,
      read: false,
    });
    expect(inbox.body.unread).toBeGreaterThanOrEqual(1);
    // The reporter (no maintenance.manage) is not told.
    expect(
      (await hk.get('/api/v1/me/notifications')).body.items.some(
        (n: { kind: string }) => n.kind === 'MAINTENANCE_URGENT',
      ),
    ).toBe(false);

    // Someone else's notification cannot be touched.
    expect((await hk.request('POST', `/api/v1/me/notifications/${urgent.id}/read`)).status).toBe(
      404,
    );
    expect((await john.request('POST', `/api/v1/me/notifications/${urgent.id}/read`)).status).toBe(
      204,
    );
    const after = await john.get('/api/v1/me/notifications?unread=true');
    expect(after.body.items.some((n: { id: string }) => n.id === urgent.id)).toBe(false);
    expect((await john.request('POST', '/api/v1/me/notifications/read-all')).status).toBe(204);
    expect((await john.get('/api/v1/me/notifications')).body.unread).toBe(0);
  });

  it('tell technicians about their assignments', async () => {
    const roles = (await admin.get('/api/v1/roles')).body as { key: string; id: string }[];
    const members = (await admin.get('/api/v1/members')).body as {
      email: string;
      membershipId: string;
    }[];
    const runner = members.find((m) => m.email === 'runner@abc.test')!.membershipId;
    await admin.request('POST', `/api/v1/members/${runner}/role-assignments`, {
      roleId: roles.find((r) => r.key === 'maintenance_technician')!.id,
      propertyId: MNL(),
    });
    const tech = await TestClient.as(ctx.app, 'runner@abc.test');
    const request = (
      await john.request('POST', `${base()}/maintenance`, {
        roomId: inv().rooms['104'],
        category: 'ELECTRICAL',
        title: 'Lamp flickers',
      })
    ).body;
    await john.request(
      'POST',
      `${base()}/maintenance/${request.id}/actions`,
      { action: 'ASSIGN', membershipId: runner },
      { 'if-match': `W/"${request.version}"` },
    );
    const inbox = (await tech.get('/api/v1/me/notifications')).body;
    expect(inbox.items[0]).toMatchObject({
      kind: 'MAINTENANCE_ASSIGNED',
      title: `${request.requestNo}: Lamp flickers`,
      body: 'Room 104',
    });
  });
});

describe('guest messages', () => {
  it('confirm a booking by email and SMS, and a cancellation by email', async () => {
    const booking = await book(plusDays(today, 20), plusDays(today, 22));
    const [confirmation] = await mailsTo(booking.email, 'booking-confirmation');
    expect(confirmation?.data).toMatchObject({
      guestName: 'Nora',
      arrivalDate: plusDays(today, 20),
      departureDate: plusDays(today, 22),
      rooms: 1,
    });
    const sms = await ctx.app.get(NotificationsQueue).rawSms.getJobs(['waiting', 'delayed']);
    expect(sms.map((j) => j.data)).toContainEqual(
      expect.objectContaining({
        to: '+639171234567',
        text: expect.stringContaining('confirmed'),
      }),
    );

    const cancelled = await reception.request(
      'POST',
      `${base()}/reservations/${booking.id}/cancel`,
      { reason: 'Plans changed' },
    );
    expect(cancelled.status).toBe(200);
    expect(await mailsTo(booking.email, 'booking-cancelled')).toHaveLength(1);
  });

  it('welcome the guest at check-in', async () => {
    const booking = await book(today, plusDays(today, 1), '101');
    const line = `${base()}/reservations/${booking.id}/rooms/${booking.lineId}`;
    expect((await reception.request('POST', `${line}/check-in`)).status).toBe(200);
    const [welcome] = await mailsTo(booking.email, 'checked-in');
    expect(welcome?.data).toMatchObject({ roomNumber: '101', departureDate: plusDays(today, 1) });
  });
});

describe('daily reminders', () => {
  it('invite tomorrow’s arrivals to check in online and remind departures, once', async () => {
    const arriving = await book(plusDays(today, 1), plusDays(today, 3));
    const departing = await book(today, plusDays(today, 1), '102');
    expect(
      (
        await reception.request(
          'POST',
          `${base()}/reservations/${departing.id}/rooms/${departing.lineId}/check-in`,
        )
      ).status,
    ).toBe(200);

    const first = await runReminders(today);
    expect(first.checkIn).toBeGreaterThanOrEqual(1);
    const [invite] = await mailsTo(arriving.email, 'checkin-reminder');
    expect(invite?.data).toMatchObject({ arrivalDate: plusDays(today, 1) });
    expect((invite?.data as { portalUrl: string }).portalUrl).toContain('/welcome#token=');

    const departure = await runReminders(plusDays(today, 1));
    expect(departure.checkOut).toBeGreaterThanOrEqual(1);
    expect(await mailsTo(departing.email, 'checkout-reminder')).toHaveLength(1);

    // A rerun (retry, second worker) sends nothing again.
    await runReminders(today);
    await runReminders(plusDays(today, 1));
    expect(await mailsTo(arriving.email, 'checkin-reminder')).toHaveLength(1);
    expect(await mailsTo(departing.email, 'checkout-reminder')).toHaveLength(1);
  });

  it('tell HR about birthdays at the property, respecting privacy', async () => {
    const employees = (await admin.get('/api/v1/employees')).body.items as {
      id: string;
      employeeNo: string;
    }[];
    const e001 = employees.find((e) => e.employeeNo === 'E001')!;
    const current = await admin.get(`/api/v1/employees/${e001.id}`);
    const updated = await admin.request(
      'PATCH',
      `/api/v1/employees/${e001.id}`,
      { birthdayVisibility: 'DAY_MONTH', personal: { birthDate: '1990-12-25' } },
      { 'if-match': String(current.headers.etag) },
    );
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);

    expect((await runReminders('2026-12-24')).birthdays).toBe(0);
    expect((await runReminders('2026-12-25')).birthdays).toBe(1);
    const inbox = (await maria.get('/api/v1/me/notifications')).body.items;
    expect(inbox).toContainEqual(
      expect.objectContaining({ kind: 'BIRTHDAYS_TODAY', body: 'John Reyes' }),
    );
    expect((await runReminders('2026-12-25')).birthdays).toBe(0);
  });
});
