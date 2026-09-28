/**
 * Events and the unified calendar (ADR-0026): events with participants and their
 * notifications, the merged calendar gated per kind, and the events-today reminder.
 * MNL's business date is 2026-10-01; its time zone is Asia/Manila (+08:00).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantJobsProcessor } from '../src/modules/jobs/tenant-jobs.processor.js';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let john: TestClient;
let hk: TestClient;
let reception: TestClient;
let hkMembership: string;
let receptionMembership: string;

const MNL = () => ctx.world.abc.properties.MNL;
const base = () => `/api/v1/properties/${MNL()}`;
const inv = () => ctx.world.inventory.MNL;
const ifMatch = (version: number) => ({ 'if-match': `W/"${version}"` });

type Notification = { kind: string; title: string; body: string; propertyId: string | null };
const inbox = async (client: TestClient) =>
  (await client.get('/api/v1/me/notifications')).body.items as Notification[];

const runReminders = (localDate: string) =>
  ctx.app.get(TenantJobsProcessor).run({
    type: 'property.daily-reminders',
    organizationId: ctx.world.abc.organizationId,
    propertyId: MNL(),
    localDate,
  }) as Promise<{ events: number }>;

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  john = await TestClient.withMfa(ctx.app, 'john.gm@abc.test');
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  const members = (await admin.get('/api/v1/members')).body as {
    email: string;
    membershipId: string;
  }[];
  hkMembership = members.find((m) => m.email === 'hk@abc.test')!.membershipId;
  receptionMembership = members.find((m) => m.email === 'reception@abc.test')!.membershipId;
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('events', () => {
  let training: { id: string; version: number };

  it('managers schedule events; participants are told, the organizer is not', async () => {
    const res = await john.request('POST', `${base()}/events`, {
      title: 'Fire drill training',
      category: 'TRAINING',
      startsAt: '2026-10-05T14:00:00+08:00',
      endsAt: '2026-10-05T16:00:00+08:00',
      location: 'Function room',
      participantMembershipIds: [hkMembership, receptionMembership],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Fire drill training',
      status: 'SCHEDULED',
      startsAt: '2026-10-05T06:00:00.000Z',
      guestVisible: false,
      organizerName: 'John Reyes',
      participants: [
        { membershipId: hkMembership, name: 'Hana Housekeeper' },
        { membershipId: receptionMembership, name: 'Rey Reception' },
      ],
      version: 1,
    });
    training = res.body;

    expect(await inbox(hk)).toContainEqual(
      expect.objectContaining({
        kind: 'EVENT_INVITED',
        title: 'Invited: Fire drill training',
        body: '2026-10-05 14:00 · Function room',
      }),
    );
    expect((await inbox(john)).some((n) => n.kind === 'EVENT_INVITED')).toBe(false);
  });

  it('rejects bad input and staff without event.manage', async () => {
    const valid = {
      title: 'Party',
      category: 'EMPLOYEE_ACTIVITY',
      startsAt: '2026-10-10T18:00:00+08:00',
      endsAt: '2026-10-10T22:00:00+08:00',
    };
    expect((await hk.request('POST', `${base()}/events`, valid)).status).toBe(403);
    expect(
      (
        await john.request('POST', `${base()}/events`, {
          ...valid,
          endsAt: '2026-10-10T17:00:00+08:00',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await john.request('POST', `${base()}/events`, {
          ...valid,
          participantMembershipIds: [randomUUID()],
        })
      ).status,
    ).toBe(400);
    // Everyone with self-service can read an event.
    expect((await hk.get(`${base()}/events/${training.id}`)).status).toBe(200);
    // Managers pick invitees among the staff who can see the property.
    const people = await john.get(`${base()}/events/people`);
    expect(people.status).toBe(200);
    expect(people.body.items).toContainEqual({
      membershipId: hkMembership,
      displayName: 'Hana Housekeeper',
    });
    expect((await hk.get(`${base()}/events/people`)).status).toBe(403);
  });

  it('changes need the current version and tell the participants', async () => {
    const path = `${base()}/events/${training.id}`;
    const change = { startsAt: '2026-10-06T14:00:00+08:00', endsAt: '2026-10-06T16:00:00+08:00' };
    expect((await john.request('PATCH', path, change, ifMatch(99))).status).toBe(412);
    // The end must stay after the start, including against the stored value.
    expect(
      (await john.request('PATCH', path, { endsAt: '2026-10-05T13:00:00+08:00' }, ifMatch(1)))
        .status,
    ).toBe(400);
    const res = await john.request(
      'PATCH',
      path,
      { ...change, participantMembershipIds: [hkMembership] },
      ifMatch(1),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      version: 2,
      startsAt: '2026-10-06T06:00:00.000Z',
      participants: [{ membershipId: hkMembership }],
    });
    expect(await inbox(hk)).toContainEqual(
      expect.objectContaining({ kind: 'EVENT_CHANGED', body: '2026-10-06 14:00 · Function room' }),
    );
    training = res.body;
  });

  it('events-today reminders reach participants once', async () => {
    expect((await runReminders('2026-10-05')).events).toBe(0);
    expect((await runReminders('2026-10-06')).events).toBe(1);
    expect((await runReminders('2026-10-06')).events).toBe(0);
    expect(await inbox(hk)).toContainEqual(
      expect.objectContaining({
        kind: 'EVENTS_TODAY',
        title: 'Today: Fire drill training',
        body: '14:00 · Function room',
      }),
    );
    expect((await inbox(reception)).some((n) => n.kind === 'EVENTS_TODAY')).toBe(false);
  });

  it('cancelling tells participants and freezes the event', async () => {
    const path = `${base()}/events/${training.id}`;
    const res = await john.request('PATCH', path, { status: 'CANCELLED' }, ifMatch(2));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(await inbox(hk)).toContainEqual(
      expect.objectContaining({ kind: 'EVENT_CHANGED', title: 'Cancelled: Fire drill training' }),
    );
    expect((await john.request('PATCH', path, { title: 'Again' }, ifMatch(3))).status).toBe(409);
  });
});

describe('unified calendar', () => {
  const view = (client: TestClient, from: string, to: string) =>
    client.get(`${base()}/calendar?from=${from}&to=${to}`);
  type Item = {
    id: string;
    kind: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
  };

  beforeAll(async () => {
    const booked = await reception.request(
      'POST',
      `${base()}/reservations`,
      {
        source: 'DIRECT',
        booker: { newGuest: { firstName: 'Cal', lastName: 'Endar', email: null } },
        rooms: [
          {
            roomTypeId: inv().roomTypes.STD,
            ratePlanId: inv().ratePlans.BAR,
            arrivalDate: '2026-12-20',
            departureDate: '2026-12-22',
            adults: 1,
          },
        ],
      },
      { 'idempotency-key': `test-${randomUUID()}` },
    );
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    const event = await john.request('POST', `${base()}/events`, {
      title: 'Christmas party',
      category: 'EMPLOYEE_ACTIVITY',
      startsAt: '2026-12-23T00:00:00+08:00',
      endsAt: '2026-12-24T00:00:00+08:00',
      allDay: true,
      location: 'Ballroom',
    });
    expect(event.status, JSON.stringify(event.body)).toBe(201);
    // John (E001) shares his birthday.
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
  });

  it('merges arrivals, departures, events and birthdays for a manager', async () => {
    const res = await view(john, '2026-12-01', '2026-12-31');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.timezone).toBe('Asia/Manila');
    const items = res.body.items as Item[];
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'ARRIVAL',
        title: 'Arrival: Cal Endar (STD)',
        start: '2026-12-20',
        end: '2026-12-21',
        allDay: true,
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({ kind: 'DEPARTURE', start: '2026-12-22' }),
    );
    // An all-day event is shown by its local dates.
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'EVENT',
        title: 'Christmas party · Ballroom',
        start: '2026-12-23',
        end: '2026-12-24',
        allDay: true,
        category: 'EMPLOYEE_ACTIVITY',
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'BIRTHDAY',
        title: 'Birthday: John Reyes',
        start: '2026-12-25',
      }),
    );
    // Cancelled events are gone.
    const october = (await view(john, '2026-10-01', '2026-10-31')).body.items as Item[];
    expect(october.some((i) => i.title.startsWith('Fire drill'))).toBe(false);
  });

  it('shows others only what their permissions reach', async () => {
    const items = (await view(hk, '2026-12-01', '2026-12-31')).body.items as Item[];
    expect(items.some((i) => i.kind === 'EVENT')).toBe(true);
    expect(items.some((i) => i.kind === 'ARRIVAL' || i.kind === 'DEPARTURE')).toBe(false);
    expect(items.some((i) => i.kind === 'OUT_OF_ORDER')).toBe(false);
  });

  it('limits the range', async () => {
    expect((await view(john, '2026-10-01', '2026-12-31')).status).toBe(400);
    expect((await view(john, '2026-10-02', '2026-10-01')).status).toBe(400);
  });
});
