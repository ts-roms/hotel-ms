/**
 * Workforce records (ADR-0028, hr/workforce): employment type and emergency contact, pay
 * history, trainings and certifications with expiry reminders, performance reviews.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantJobsProcessor } from '../src/modules/jobs/tenant-jobs.processor.js';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
/** HR manager at Manila and Cebu, with two-step verification. */
let maria: TestClient;
/** General manager at Manila, without two-step verification. */
let john: TestClient;
let hk: TestClient;

const HR = () => ctx.world.hr.abc;
const emp = (no: string) => `/api/v1/employees/${HR().employees[no]}`;
const plusDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Today in Manila, the demo organization's time zone. */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

beforeAll(async () => {
  ctx = await startTestApp();
  maria = await TestClient.withMfa(ctx.app, 'maria.hr@abc.test');
  john = await TestClient.as(ctx.app, 'john.gm@abc.test');
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('employee profile', () => {
  it('records the employment type, and the emergency contact as a personal detail', async () => {
    const current = await maria.get(emp('E004'));
    expect(current.body.employmentType).toBe('FULL_TIME');
    const res = await maria.request(
      'PATCH',
      emp('E004'),
      {
        employmentType: 'PART_TIME',
        personal: {
          emergencyContact: {
            name: 'Hector Housekeeper',
            relationship: 'Father',
            phone: '+63 917 000 1111',
          },
        },
      },
      { 'if-match': String(current.headers.etag) },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      employmentType: 'PART_TIME',
      personal: {
        emergencyContact: {
          name: 'Hector Housekeeper',
          relationship: 'Father',
          phone: '+63 917 000 1111',
        },
      },
    });
    // Without the personal-details permission (and two-step verification): type only.
    const seen = await john.get(emp('E004'));
    expect(seen.body.employmentType).toBe('PART_TIME');
    expect(seen.body.personal).toBeNull();

    expect(
      (
        await maria.request(
          'PATCH',
          emp('E004'),
          { employmentType: 'GIG' },
          { 'if-match': String(res.headers.etag) },
        )
      ).status,
    ).toBe(400);
  });
});

describe('pay history', () => {
  it('is start-dated, sensitive and scoped', async () => {
    const url = `${emp('E004')}/compensation`;
    const first = await maria.request('POST', url, {
      effectiveFrom: '2026-01-01',
      payBasis: 'MONTHLY',
      amountMinor: 2_500_000,
      currency: 'PHP',
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const raise = await maria.request('POST', url, {
      effectiveFrom: plusDays(today(), 60),
      payBasis: 'MONTHLY',
      amountMinor: 2_750_000,
      currency: 'PHP',
      notes: 'Annual increase',
    });
    expect(raise.status).toBe(201);
    expect(raise.body.history).toHaveLength(2);
    // The raise starts later: today's pay is still the first record.
    expect(raise.body.current).toMatchObject({
      effectiveFrom: '2026-01-01',
      amountMinor: 2_500_000,
      createdByName: 'Maria Santos',
    });

    expect((await john.get(url)).status).toBe(403);
    expect((await hk.get(url)).status).toBe(403);
    // Lina works in Davao, outside Maria's properties.
    expect((await maria.get(`${emp('E007')}/compensation`)).status).toBe(404);
    expect(
      (await maria.request('POST', url, { ...first.body.current, currency: 'pesos' })).status,
    ).toBe(400);
  });
});

describe('training and certifications', () => {
  it('flags certifications that expire soon or have expired', async () => {
    const url = `${emp('E004')}/training`;
    const add = (body: object) => maria.request('POST', url, body);
    expect(
      (
        await add({
          kind: 'TRAINING',
          title: 'Chemical safety',
          provider: 'In-house',
          completedOn: '2026-02-10',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await add({
          kind: 'CERTIFICATION',
          title: 'First aid',
          completedOn: '2025-01-15',
          expiresOn: plusDays(today(), 10),
        })
      ).status,
    ).toBe(201);
    const res = await add({
      kind: 'CERTIFICATION',
      title: 'Food handling',
      completedOn: '2024-01-15',
      expiresOn: '2025-01-15',
    });
    expect(res.status).toBe(201);
    const byTitle = Object.fromEntries(
      res.body.items.map((t: { title: string; expiry: string | null }) => [t.title, t.expiry]),
    );
    expect(byTitle).toEqual({
      'Chemical safety': null,
      'First aid': 'EXPIRING',
      'Food handling': 'EXPIRED',
    });

    expect(
      (
        await add({
          kind: 'CERTIFICATION',
          title: 'Backwards',
          completedOn: '2026-02-10',
          expiresOn: '2026-01-10',
        })
      ).status,
    ).toBe(400);
    // Read with employee.read; recorded with employee.manage.
    expect((await john.get(url)).status).toBe(200);
    expect((await hk.get(url)).status).toBe(403);

    const food = res.body.items.find((t: { title: string }) => t.title === 'Food handling');
    expect((await maria.request('DELETE', `${url}/${food.id}`)).status).toBe(204);
    expect((await maria.get(url)).body.items).toHaveLength(2);
  });

  it('reminds HR and the employee before a certification expires, once', async () => {
    const localDate = '2026-10-10';
    const created = await maria.request('POST', `${emp('E004')}/training`, {
      kind: 'CERTIFICATION',
      title: 'Pool lifeguard',
      expiresOn: plusDays(localDate, 30),
    });
    expect(created.status).toBe(201);
    const run = () =>
      ctx.app.get(TenantJobsProcessor).run({
        type: 'organization.daily-documents',
        organizationId: ctx.world.abc.organizationId,
        localDate,
      }) as Promise<{ certificationReminders: number }>;
    expect((await run()).certificationReminders).toBe(1);
    expect((await run()).certificationReminders).toBe(0);

    const inbox = await maria.get('/api/v1/me/notifications');
    expect(inbox.body.items).toContainEqual(
      expect.objectContaining({
        kind: 'CERTIFICATIONS_EXPIRING',
        title: `Hana Housekeeper: Pool lifeguard expires on ${plusDays(localDate, 30)}`,
      }),
    );
    const own = await hk.get('/api/v1/me/notifications');
    expect(own.body.items).toContainEqual(
      expect.objectContaining({
        title: `Your Pool lifeguard expires on ${plusDays(localDate, 30)}`,
      }),
    );
  });
});

describe('performance reviews', () => {
  it('are sensitive, and nobody reviews themselves', async () => {
    const url = `${emp('E004')}/reviews`;
    const review = {
      reviewDate: '2026-09-15',
      periodFrom: '2026-01-01',
      periodTo: '2026-06-30',
      rating: 4,
      summary: 'Reliable and thorough.',
      strengths: 'Attention to detail',
      goals: 'Train as a room inspector',
    };
    const res = await maria.request('POST', url, review);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.items[0]).toMatchObject({ ...review, reviewerName: 'Maria Santos' });

    expect((await maria.request('POST', url, { ...review, rating: 6 })).status).toBe(400);
    expect((await maria.request('POST', `${emp('E002')}/reviews`, review)).status).toBe(403);
    expect((await john.get(url)).status).toBe(403);
    expect((await hk.get(url)).status).toBe(403);
  });
});
