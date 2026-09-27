/**
 * Scheduled jobs and HR follow-ups (ADR-0017): the two-step leave approval chain, the
 * monthly accrual job, the nightly reconciliation job and the payroll export.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantJobsProcessor } from '../src/modules/jobs/tenant-jobs.processor.js';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let maria: TestClient;
let john: TestClient;
let reception: TestClient;
let jobs: TenantJobsProcessor;

const P = () => ctx.world.abc.properties;
const HR = () => ctx.world.hr.abc;
const mnl = () => `/api/v1/properties/${P().MNL}`;
const ifMatch = (version: number) => ({ 'if-match': `W/"${version}"` });
const manilaDay = (days = 0) =>
  new Date(Date.now() + 8 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);

const balance = async (client: TestClient, code: string) =>
  (await client.get('/api/v1/me/leave')).body.balances.find(
    (b: { leaveTypeCode: string }) => b.leaveTypeCode === code,
  )?.days;

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  maria = await TestClient.withMfa(ctx.app, 'maria.hr@abc.test');
  john = await TestClient.as(ctx.app, 'john.gm@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  jobs = ctx.app.get(TenantJobsProcessor);
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('two-step leave approval', () => {
  const request = async (startDate: string) => {
    const res = await reception.request('POST', '/api/v1/me/leave-requests', {
      leaveTypeId: HR().leaveTypes.VL,
      startDate,
      endDate: startDate,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const decide = (client: TestClient, id: string, version: number, decision = 'APPROVE') =>
    client.request(
      'POST',
      `${mnl()}/leave-requests/${id}/decision`,
      { decision, note: `${decision} by test` },
      ifMatch(version),
    );

  beforeAll(async () => {
    const res = await admin.request('PATCH', `/api/v1/leave-types/${HR().leaveTypes.VL}`, {
      hrApprovalRequired: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hrApprovalRequired).toBe(true);
  });

  it('the manager approves first, then HR; the days are debited once, at the end', async () => {
    const leave = await request('2026-11-16');
    expect(leave).toMatchObject({ approvalsRequired: 2, approvalStep: 1, approvals: [] });

    const first = await decide(john, leave.id, leave.version);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ status: 'PENDING', approvalStep: 2 });
    expect(first.body.approvals).toEqual([
      expect.objectContaining({ step: 1, decision: 'APPROVE', decidedBy: 'John Reyes' }),
    ]);
    expect(await balance(reception, 'VL')).toBe(10);

    // John holds leave.approve but not leave.manage: the HR step is not his.
    expect((await decide(john, leave.id, first.body.version)).status).toBe(403);
    const second = await decide(maria, leave.id, first.body.version);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ status: 'APPROVED', approvalStep: 2 });
    expect(second.body.approvals.map((a: { decidedBy: string }) => a.decidedBy)).toEqual([
      'John Reyes',
      'Maria Santos',
    ]);
    expect(await balance(reception, 'VL')).toBe(9);
    const mail = await ctx.mailbox.latestFor('reception@abc.test', 'leave-decided');
    expect(mail?.data).toMatchObject({ decision: 'APPROVED', startDate: '2026-11-16' });
  });

  it('needs two different people, and a rejection at any step ends it', async () => {
    const leave = await request('2026-11-18');
    const first = await decide(maria, leave.id, leave.version);
    expect(first.body.approvalStep).toBe(2);
    expect((await decide(maria, leave.id, first.body.version)).status).toBe(403);
    expect((await decide(admin, leave.id, first.body.version)).body.status).toBe('APPROVED');

    const other = await request('2026-11-20');
    const rejected = await decide(john, other.id, other.version, 'REJECT');
    expect(rejected.body).toMatchObject({ status: 'REJECTED', approvalStep: 1 });
    expect(await balance(reception, 'VL')).toBe(8);
  });
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

describe('payroll export', () => {
  it('is a CSV of attendance and leave, for HR with MFA only', async () => {
    const punch = (type: string) =>
      reception.request('POST', `${mnl()}/attendance/punches`, { type });
    expect((await punch('IN')).status).toBe(201);
    expect((await punch('OUT')).status).toBe(201);

    const today = manilaDay();
    const small = `${mnl()}/payroll-export?from=${today}&to=${today}`;
    const res = await ctx.app.inject({
      method: 'GET',
      url: small,
      headers: { cookie: maria.cookieHeader! },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(`payroll-${today}-${today}.csv`);
    const lines = res.body.trim().split('\r\n');
    expect(lines[0]).toBe(
      'employee_no,employee_name,date,status,shift_start,shift_end,first_in,last_out,worked_minutes,break_minutes,late_minutes,undertime_minutes,overtime_minutes,leave_type,leave_paid',
    );
    expect(lines.some((l) => l.startsWith(`E003,Rey Reception,${today},PRESENT`))).toBe(true);

    // Approved leave shows with its type and pay flag.
    const withLeave = await ctx.app.inject({
      method: 'GET',
      url: `${mnl()}/payroll-export?from=2026-11-16&to=2026-11-16`,
      headers: { cookie: maria.cookieHeader! },
    });
    expect(withLeave.body).toContain('E003,Rey Reception,2026-11-16,ON_LEAVE');
    expect(withLeave.body).toMatch(/2026-11-16,ON_LEAVE,.*,VL,yes/);

    expect((await john.get(small)).status).toBe(403);
    expect((await reception.get(small)).status).toBe(403);
    // At most 62 days per export.
    expect((await maria.get(`${mnl()}/payroll-export?from=2026-01-01&to=2026-12-31`)).status).toBe(
      400,
    );
  });
});
