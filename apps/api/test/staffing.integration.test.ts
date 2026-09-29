/**
 * Staffing (ADR-0028, hr/time): recurring shifts, minimum staffing and understaffing
 * detection.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
/** HR manager at Manila and Cebu, with two-step verification. */
let maria: TestClient;
/** General manager at Manila, without two-step verification. */
let john: TestClient;
let hk: TestClient;

const HR = () => ctx.world.hr.abc;
const MNL = () => ctx.world.abc.properties.MNL;
const mnl = () => `/api/v1/properties/${MNL()}`;
const ifMatch = (version: number) => ({ 'if-match': `W/"${version}"` });

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

describe('recurring shifts', () => {
  let seriesId: string;

  it('create drafts on chosen weekdays, skipping leave and overlaps', async () => {
    // Hana is on approved leave on Friday 2026-11-06.
    const leave = await hk.request('POST', '/api/v1/me/leave-requests', {
      leaveTypeId: HR().leaveTypes.VL,
      startDate: '2026-11-06',
      endDate: '2026-11-06',
    });
    expect(leave.status, JSON.stringify(leave.body)).toBe(201);
    const decided = await maria.request(
      'POST',
      `${mnl()}/leave-requests/${leave.body.id}/decision`,
      { decision: 'APPROVE' },
      ifMatch(leave.body.version),
    );
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    // Carlo already works Wednesday 2026-11-04.
    const single = await maria.request('POST', `${mnl()}/shifts`, {
      employeeId: HR().employees.E006,
      date: '2026-11-04',
      startTime: '06:00',
      endTime: '14:00',
    });
    expect(single.status, JSON.stringify(single.body)).toBe(201);

    const res = await maria.request('POST', `${mnl()}/shifts/recurring`, {
      employeeIds: [HR().employees.E004, HR().employees.E006],
      from: '2026-11-02',
      to: '2026-11-15',
      weekdays: [1, 3, 5],
      startTime: '07:00',
      endTime: '15:00',
      breakMinutes: 60,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // 2 people × 6 days, minus Hana's leave and Carlo's existing shift.
    expect(res.body.created).toBe(10);
    expect(res.body.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeName: 'Hana Housekeeper',
          date: '2026-11-06',
          reason: 'ON_LEAVE',
        }),
        expect.objectContaining({
          employeeName: 'Carlo Cruz',
          date: '2026-11-04',
          reason: 'OVERLAP',
        }),
      ]),
    );
    seriesId = res.body.seriesId;

    const week = await maria.get(`${mnl()}/schedule?from=2026-11-02&to=2026-11-08`);
    const series = week.body.shifts.filter((s: { seriesId: string }) => s.seriesId === seriesId);
    // Mon: both; Wed: Hana (Carlo is busy); Fri: Carlo (Hana is on leave).
    expect(series).toHaveLength(4);
    expect(series[0]).toMatchObject({ startTime: '07:00', endTime: '15:00', status: 'DRAFT' });
  });

  it('validate the request and the employees', async () => {
    const base = {
      employeeIds: [HR().employees.E004],
      from: '2026-12-01',
      to: '2026-12-07',
      weekdays: [1],
      startTime: '07:00',
      endTime: '15:00',
    };
    const post = (body: object, client = maria) =>
      client.request('POST', `${mnl()}/shifts/recurring`, body);
    expect((await post({ ...base, to: '2027-04-01' })).status).toBe(400);
    expect((await post({ ...base, weekdays: [1, 1] })).status).toBe(400);
    expect((await post({ ...base, startTime: undefined })).status).toBe(400);
    // Lina works in Davao.
    expect((await post({ ...base, employeeIds: [HR().employees.E007] })).status).toBe(400);
    expect((await post(base, hk)).status).toBe(403);
  });

  it('are cancelled as a series from a date on', async () => {
    const url = `${mnl()}/shift-series/${seriesId}/cancel`;
    expect((await hk.request('POST', url, {})).status).toBe(403);
    // One person's shifts from a date on, then everyone's.
    const carlo = await maria.request('POST', url, {
      fromDate: '2026-11-13',
      employeeId: HR().employees.E006,
    });
    expect(carlo.status, JSON.stringify(carlo.body)).toBe(200);
    expect(carlo.body.cancelled).toBe(1);
    const res = await maria.request('POST', url, { fromDate: '2026-11-09' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.cancelled).toBe(5);
    const later = await maria.get(`${mnl()}/schedule?from=2026-11-09&to=2026-11-15`);
    expect(later.body.shifts.some((s: { seriesId: string }) => s.seriesId === seriesId)).toBe(
      false,
    );
    expect(
      (await maria.request('POST', `${mnl()}/shift-series/${crypto.randomUUID()}/cancel`, {}))
        .status,
    ).toBe(404);
  });
});

describe('minimum staffing', () => {
  it('finds understaffed windows, counting only shifts that cover them and people not on leave', async () => {
    const url = `${mnl()}/staffing-requirements`;
    const housekeeping = {
      departmentId: HR().departments.HK,
      weekdays: [1, 3, 5],
      startTime: '08:00',
      endTime: '12:00',
      minStaff: 2,
    };
    expect((await hk.request('POST', url, housekeeping)).status).toBe(403);
    expect((await maria.request('POST', url, { ...housekeeping, endTime: '08:00' })).status).toBe(
      400,
    );
    const created = await maria.request('POST', url, housekeeping);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const weekend = await maria.request('POST', url, {
      departmentId: HR().departments.HK,
      weekdays: [6],
      startTime: '09:00',
      endTime: '17:00',
      minStaff: 1,
    });
    expect(weekend.body.items).toHaveLength(2);

    const coverage = await john.get(`${mnl()}/schedule/coverage?from=2026-11-02&to=2026-11-08`);
    expect(coverage.status).toBe(200);
    const gaps = coverage.body.items.map(
      (g: { date: string; startTime: string; scheduled: number; required: number }) =>
        `${g.date} ${g.startTime} ${g.scheduled}/${g.required}`,
    );
    // Mon: Hana and Carlo (series). Wed: Carlo's 06–14 covers 08–12 too. Fri: Hana on leave.
    // Sat: nobody.
    expect(gaps).toEqual(['2026-11-06 08:00 1/2', '2026-11-07 09:00 0/1']);
  });

  it('are reported when publishing', async () => {
    const res = await maria.request('POST', `${mnl()}/schedule/publish`, {
      from: '2026-11-02',
      to: '2026-11-08',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.published).toBeGreaterThan(0);
    expect(res.body.gaps).toHaveLength(2);
    expect(res.body.gaps[0]).toMatchObject({ date: '2026-11-06', scheduled: 1, published: 1 });

    const requirements = await john.get(`${mnl()}/staffing-requirements`);
    const saturday = requirements.body.items.find((r: { weekdays: number[] }) =>
      r.weekdays.includes(6),
    );
    expect(
      (await maria.request('POST', `${mnl()}/staffing-requirements/${saturday.id}/archive`)).status,
    ).toBe(204);
    const after = await john.get(`${mnl()}/schedule/coverage?from=2026-11-02&to=2026-11-08`);
    expect(after.body.items).toHaveLength(1);
  });
});
