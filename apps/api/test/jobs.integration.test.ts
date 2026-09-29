/**
 * Scheduled tenant jobs (ADR-0017, jobs/): the monthly accrual job and the nightly
 * reconciliation job.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantJobsProcessor } from '../src/modules/jobs/tenant-jobs.processor.js';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let john: TestClient;
let reception: TestClient;
let jobs: TenantJobsProcessor;

const P = () => ctx.world.abc.properties;
const HR = () => ctx.world.hr.abc;
const mnl = () => `/api/v1/properties/${P().MNL}`;

const balance = async (client: TestClient, code: string) =>
  (await client.get('/api/v1/me/leave')).body.balances.find(
    (b: { leaveTypeCode: string }) => b.leaveTypeCode === code,
  )?.days;

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  john = await TestClient.as(ctx.app, 'john.gm@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  jobs = ctx.app.get(TenantJobsProcessor);
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('scheduled jobs', () => {
  it('the monthly accrual credits every active employee once per month', async () => {
    const res = await admin.request('PATCH', `/api/v1/leave-types/${HR().leaveTypes.SIL}`, {
      accrualDaysPerMonth: 1.5,
    });
    expect(res.body.accrualDaysPerMonth).toBe(1.5);
    expect(
      (
        await admin.request('PATCH', `/api/v1/leave-types/${HR().leaveTypes.SIL}`, {
          accrualDaysPerMonth: 1.25,
        })
      ).status,
    ).toBe(400);

    const before = await balance(reception, 'SIL');
    const job = {
      type: 'organization.monthly-accrual' as const,
      organizationId: ctx.world.abc.organizationId,
      period: '2026-10',
    };
    const posted = await jobs.run(job);
    expect(posted).toBe(7); // the seven ABC demo employees
    expect(await balance(reception, 'SIL')).toBe(before + 1.5);
    expect(await jobs.run(job)).toBe(0);
    expect(await balance(reception, 'SIL')).toBe(before + 1.5);
    // Other organizations' employees are untouched by ABC's job.
    const xyz = { ...job, organizationId: ctx.world.xyz.organizationId };
    expect(await jobs.run(xyz)).toBe(0); // XYZ has no accruing leave type
  });

  it('the nightly run reconciles each property once per local date', async () => {
    const job = {
      type: 'property.nightly' as const,
      organizationId: ctx.world.abc.organizationId,
      propertyId: P().MNL,
      localDate: '2026-10-01',
    };
    expect(await jobs.run(job)).toBe(true);
    expect(await jobs.run(job)).toBe(false);
    const runs = await john.get(`${mnl()}/reports/reconciliation-runs`);
    expect(runs.status).toBe(200);
    expect(runs.body.items).toEqual([
      expect.objectContaining({ runDate: '2026-10-01', ok: true, issues: [] }),
    ]);
    expect((await reception.get(`${mnl()}/reports/reconciliation-runs`)).status).toBe(403);
    // Runs are per tenant.
    const xyz = await TestClient.withMfa(ctx.app, 'admin@xyz.test');
    expect((await xyz.get(`${mnl()}/reports/reconciliation-runs`)).status).toBe(404);
  });
});
