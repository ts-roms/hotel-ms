/**
 * HR (blueprint §13): employee scope by assignment, personal-data protection, scheduling
 * with overlap and rest rules, publishing, the clock, attendance corrections, the leave
 * ledger and approvals, calendar privacy and birthdays.
 */
import { createPrismaClient, withDbContext } from '@hotel/database';
import { testDatabaseUrls } from '@hotel/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient, webPunch } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let maria: TestClient;
let mariaNoMfa: TestClient;
let john: TestClient;
let reception: TestClient;
let hk: TestClient;
let xyzAdmin: TestClient;

const P = () => ctx.world.abc.properties;
const HR = () => ctx.world.hr.abc;
const E = (no: string) => HR().employees[no]!;
const mnl = () => `/api/v1/properties/${P().MNL}`;
const ifMatch = (version: number) => ({ 'if-match': `W/"${version}"` });
const nos = (res: { body: { items: { employeeNo: string }[] } }) =>
  res.body.items.map((e) => e.employeeNo).sort();

/** Manila calendar date `days` from today. */
const manilaDay = (days = 0) =>
  new Date(Date.now() + 8 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  maria = await TestClient.withMfa(ctx.app, 'maria.hr@abc.test');
  // Maria's second device: same account, a session that never did the second factor.
  mariaNoMfa = new TestClient(ctx.app);
  john = await TestClient.as(ctx.app, 'john.gm@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
  xyzAdmin = await TestClient.withMfa(ctx.app, 'admin@xyz.test');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('employees', () => {
  it('are visible by assignment scope, and never across tenants', async () => {
    expect(nos(await admin.get('/api/v1/employees'))).toEqual([
      'E001',
      'E002',
      'E003',
      'E004',
      'E005',
      'E006',
      'E007',
    ]);
    // Maria (HR @ MNL, CEB) and John (GM @ MNL) see their properties' people only.
    expect(nos(await maria.get('/api/v1/employees'))).toEqual([
      'E001',
      'E002',
      'E003',
      'E004',
      'E005',
      'E006',
    ]);
    expect(nos(await john.get('/api/v1/employees'))).toEqual([
      'E001',
      'E002',
      'E003',
      'E004',
      'E006',
    ]);
    expect(nos(await xyzAdmin.get('/api/v1/employees'))).toEqual(['E001']);
    expect((await maria.get(`/api/v1/employees/${E('E007')}`)).status).toBe(404);
    expect((await xyzAdmin.get(`/api/v1/employees/${E('E003')}`)).status).toBe(404);
    // Staff without employee.read.
    expect((await reception.get('/api/v1/employees')).status).toBe(403);
  });

  it('show personal details only to HR with an MFA-verified session', async () => {
    const byHr = await maria.get(`/api/v1/employees/${E('E003')}`);
    expect(byHr.body.personal).toEqual({
      birthDate: '1995-10-20',
      personalEmail: null,
      personalPhone: null,
      emergencyContact: null,
    });
    const byGm = await john.get(`/api/v1/employees/${E('E003')}`);
    expect(byGm.status).toBe(200);
    expect(byGm.body.personal).toBeNull();
    expect(JSON.stringify(byGm.body)).not.toContain('1995');

    const login = await mariaNoMfa.login('maria.hr@abc.test');
    expect(login.body.mfaPending).toBe(true);
    // The second factor is outstanding: nothing but the MFA challenge works.
    expect((await mariaNoMfa.get(`/api/v1/employees/${E('E003')}`)).status).toBe(401);

    // HR Manager held by someone without MFA: the record, but not the personal details.
    const roles = await admin.get('/api/v1/roles');
    const hrRole = roles.body.find((r: { key: string }) => r.key === 'hr_manager').id;
    const members = await admin.get('/api/v1/members');
    const faye = members.body.find(
      (m: { email: string }) => m.email === 'frontdesk@abc.test',
    ).membershipId;
    const granted = await admin.request('POST', `/api/v1/members/${faye}/role-assignments`, {
      roleId: hrRole,
      propertyId: P().CEB,
    });
    expect(granted.status, JSON.stringify(granted.body)).toBe(201);
    const noMfaHr = await TestClient.as(ctx.app, 'frontdesk@abc.test');
    const record = await noMfaHr.get(`/api/v1/employees/${E('E005')}`);
    expect(record.status).toBe(200);
    expect(record.body.personal).toBeNull();
  });

  it('are created by HR within scope, with unique numbers and valid assignments', async () => {
    const body = {
      employeeNo: 'E100',
      firstName: 'Nina',
      lastName: 'Lopez',
      hireDate: '2026-10-01',
      personal: { birthDate: '2000-02-29' },
      assignment: {
        propertyId: P().CEB,
        departmentId: HR().departments.HK,
        positionId: HR().positions.RA,
        startDate: '2026-10-01',
        isPrimary: true,
      },
    };
    const created = await maria.request('POST', '/api/v1/employees', body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.assignments).toEqual([]); // starts in the future
    expect(created.body.assignmentHistory[0].propertyName).toBe('ABC Resort Cebu');
    expect(created.headers.etag).toBe('W/"1"');

    expect((await maria.request('POST', '/api/v1/employees', body)).status).toBe(409);
    // John manages MNL only.
    const gm = await john.request('POST', '/api/v1/employees', {
      ...body,
      employeeNo: 'E101',
      personal: undefined,
    });
    expect(gm.status).toBe(403);
    // A position from another department.
    const mismatch = await maria.request('POST', '/api/v1/employees', {
      ...body,
      employeeNo: 'E102',
      assignment: { ...body.assignment, positionId: HR().positions.FDA },
    });
    expect(mismatch.status).toBe(400);
  });

  it('updates use If-Match; overlapping assignments at one property are refused', async () => {
    const current = await maria.get(`/api/v1/employees/${E('E006')}`);
    const renamed = await maria.request(
      'PATCH',
      `/api/v1/employees/${E('E006')}`,
      { preferredName: 'Carl' },
      { 'if-match': String(current.headers.etag) },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.preferredName).toBe('Carl');
    const stale = await maria.request(
      'PATCH',
      `/api/v1/employees/${E('E006')}`,
      { preferredName: 'Carlos' },
      { 'if-match': String(current.headers.etag) },
    );
    expect(stale.status).toBe(412);

    const overlap = await maria.request('POST', `/api/v1/employees/${E('E006')}/assignments`, {
      propertyId: P().MNL,
      departmentId: HR().departments.FB,
      startDate: '2026-11-01',
    });
    expect(overlap.status).toBe(409);
    const second = await maria.request('POST', `/api/v1/employees/${E('E006')}/assignments`, {
      propertyId: P().CEB,
      departmentId: HR().departments.HK,
      startDate: '2026-11-01',
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
  });

  it('departments and leave types are organization-level configuration', async () => {
    expect(
      (await maria.request('POST', '/api/v1/departments', { code: 'SPA', name: 'Spa' })).status,
    ).toBe(403);
    const created = await admin.request('POST', '/api/v1/departments', {
      code: 'SPA',
      name: 'Spa',
    });
    expect(created.status).toBe(201);
    expect(created.body.items.map((d: { code: string }) => d.code)).toContain('SPA');
    expect(
      (await admin.request('POST', '/api/v1/departments', { code: 'SPA', name: 'x' })).status,
    ).toBe(409);

    expect(
      (await maria.request('POST', '/api/v1/leave-types', { code: 'BL', name: 'Birthday Leave' }))
        .status,
    ).toBe(403);
    expect(
      (await admin.request('POST', '/api/v1/leave-types', { code: 'BL', name: 'Birthday Leave' }))
        .status,
    ).toBe(201);
  });
});

describe('scheduling', () => {
  const date = '2026-11-02';
  let morningId: string;

  it('shifts are planned in local time, cannot overlap, and warn about short rest', async () => {
    const morning = await john.request('POST', `${mnl()}/shifts`, {
      employeeId: E('E003'),
      date,
      templateId: HR().shiftTemplates['MNL:Morning'],
    });
    expect(morning.status, JSON.stringify(morning.body)).toBe(201);
    expect(morning.body).toMatchObject({
      startTime: '06:00',
      endTime: '14:00',
      startsAt: '2026-11-01T22:00:00.000Z',
      status: 'DRAFT',
      departmentName: 'Front Office',
      warnings: [],
    });
    morningId = morning.body.id;

    const overlap = await john.request('POST', `${mnl()}/shifts`, {
      employeeId: E('E003'),
      date,
      startTime: '13:00',
      endTime: '17:00',
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('SHIFT_OVERLAP');

    // Night shift the evening before ends 06:00, right when the morning shift starts.
    const night = await john.request('POST', `${mnl()}/shifts`, {
      employeeId: E('E003'),
      date: '2026-11-01',
      startTime: '22:00',
      endTime: '06:00',
      breakMinutes: 30,
    });
    expect(night.status).toBe(201);
    expect(night.body.warnings.map((w: { code: string }) => w.code)).toEqual(['SHORT_REST']);

    // Faye works in Cebu: not schedulable at Manila.
    const elsewhere = await john.request('POST', `${mnl()}/shifts`, {
      employeeId: E('E005'),
      date,
      startTime: '06:00',
      endTime: '14:00',
    });
    expect(elsewhere.status).toBe(400);
    // Staff cannot schedule.
    expect(
      (
        await reception.request('POST', `${mnl()}/shifts`, {
          employeeId: E('E003'),
          date,
          startTime: '06:00',
          endTime: '07:00',
        })
      ).status,
    ).toBe(403);
  });

  it('employees see shifts only once published, and are emailed', async () => {
    const range = `from=2026-11-01&to=2026-11-07`;
    expect((await reception.get(`/api/v1/me/shifts?${range}`)).body.items).toEqual([]);
    const published = await john.request('POST', `${mnl()}/schedule/publish`, {
      from: '2026-11-01',
      to: '2026-11-07',
    });
    expect(published.body.published).toBe(2);
    const mine = await reception.get(`/api/v1/me/shifts?${range}`);
    expect(mine.body.items.map((s: { date: string }) => s.date)).toEqual([
      '2026-11-01',
      '2026-11-02',
    ]);
    const mail = await ctx.mailbox.latestFor('reception@abc.test', 'schedule-published');
    expect(mail?.data).toMatchObject({ from: '2026-11-01', to: '2026-11-07' });

    // Editing a published shift bumps its version; the stale version is refused.
    const shift = mine.body.items.find((s: { id: string }) => s.id === morningId);
    const moved = await john.request(
      'PATCH',
      `${mnl()}/shifts/${morningId}`,
      { startTime: '07:00' },
      ifMatch(shift.version),
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({ startTime: '07:00', status: 'PUBLISHED' });
    expect(
      (
        await john.request(
          'PATCH',
          `${mnl()}/shifts/${morningId}`,
          { startTime: '08:00' },
          ifMatch(shift.version),
        )
      ).status,
    ).toBe(412);
  });
});

describe('attendance', () => {
  it('the clock follows IN → break → OUT, per employee', async () => {
    const punch = (client: TestClient, type: string) => webPunch(client, mnl(), type);
    expect((await punch(reception, 'OUT')).status).toBe(409);
    expect((await punch(reception, 'IN')).status).toBe(201);
    expect((await punch(reception, 'IN')).status).toBe(409);
    expect((await punch(reception, 'BREAK_START')).status).toBe(201);
    expect((await punch(reception, 'OUT')).status).toBe(409);
    expect((await punch(reception, 'BREAK_END')).status).toBe(201);
    expect((await punch(reception, 'OUT')).status).toBe(201);

    const me = await reception.get('/api/v1/me/employee');
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    expect(me.body.employee.employeeNo).toBe('E003');
    expect(me.body.lastPunch.type).toBe('OUT');

    // A login without an employee record cannot punch.
    const noEmployee = await punch(admin, 'IN');
    expect(noEmployee.status).toBe(403);
    expect(noEmployee.body.code).toBe('NOT_AN_EMPLOYEE');
    // Not at a property where one is not assigned.
    expect((await webPunch(reception, `/api/v1/properties/${P().CEB}`, 'IN')).status).toBe(404);
  });

  it('daily summaries for the employee and the property', async () => {
    const today = manilaDay();
    const mine = await reception.get(`/api/v1/me/attendance?from=${today}&to=${today}`);
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ date: today, status: 'PRESENT' });

    const property = await john.get(`${mnl()}/attendance?from=${today}&to=${today}`);
    expect(property.body.items.map((d: { employeeName: string }) => d.employeeName)).toContain(
      'Rey Reception',
    );
    expect((await reception.get(`${mnl()}/attendance?from=${today}&to=${today}`)).status).toBe(403);
    expect((await john.get(`${mnl()}/attendance?from=2026-01-01&to=2026-12-31`)).status).toBe(400);
  });

  it('corrections add an effective punch after approval; never your own', async () => {
    const at = `${manilaDay(-1)}T18:00:00+08:00`;
    const requested = await hk.request('POST', '/api/v1/me/attendance-corrections', {
      propertyId: P().MNL,
      type: 'IN',
      at,
      reason: 'Clock was offline',
    });
    expect(requested.status, JSON.stringify(requested.body)).toBe(201);
    const id = requested.body.id;
    const decide = (client: TestClient, version: number, decision = 'APPROVE') =>
      client.request(
        'POST',
        `${mnl()}/attendance/corrections/${id}/decision`,
        { decision },
        ifMatch(version),
      );
    expect((await decide(hk, 1)).status).toBe(403);
    const approved = await decide(john, 1);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.status).toBe('APPROVED');
    expect((await decide(john, 2)).status).toBe(409);

    // Maria decides corrections, but not her own.
    const own = await maria.request('POST', '/api/v1/me/attendance-corrections', {
      propertyId: P().MNL,
      type: 'OUT',
      at,
      reason: 'Forgot to clock out',
    });
    expect(own.status).toBe(201);
    const self = await maria.request(
      'POST',
      `${mnl()}/attendance/corrections/${own.body.id}/decision`,
      { decision: 'APPROVE' },
      ifMatch(1),
    );
    expect(self.status).toBe(403);

    const app = createPrismaClient({ connectionString: testDatabaseUrls().app, maxConnections: 1 });
    try {
      const org = { organizationId: ctx.world.abc.organizationId, identityId: null };
      const punches = await withDbContext(app, org, (tx) =>
        tx.attendancePunch.findMany({ where: { correctionId: id } }),
      );
      expect(punches).toHaveLength(1);
      expect(punches[0]).toMatchObject({ source: 'CORRECTION', type: 'IN' });
      // Punches are append-only.
      await expect(
        withDbContext(app, org, (tx) => tx.attendancePunch.updateMany({ data: { type: 'OUT' } })),
      ).rejects.toThrow(/permission denied|append-only/);
    } finally {
      await app.$disconnect();
    }
  });
});

describe('leave', () => {
  const balance = async (client: TestClient, code: string) =>
    (await client.get('/api/v1/me/leave')).body.balances.find(
      (b: { leaveTypeCode: string }) => b.leaveTypeCode === code,
    )?.days;

  it('requests respect notice, overlaps and balances', async () => {
    expect(await balance(reception, 'VL')).toBe(10);
    const vl = HR().leaveTypes.VL!;
    const tooSoon = await reception.request('POST', '/api/v1/me/leave-requests', {
      leaveTypeId: vl,
      startDate: manilaDay(1),
      endDate: manilaDay(1),
    });
    expect(tooSoon.status).toBe(400);
    const tooMuch = await reception.request('POST', '/api/v1/me/leave-requests', {
      leaveTypeId: HR().leaveTypes.SL,
      startDate: '2026-12-01',
      endDate: '2026-12-08',
    });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.code).toBe('INSUFFICIENT_LEAVE_BALANCE');

    const ok = await reception.request('POST', '/api/v1/me/leave-requests', {
      leaveTypeId: vl,
      startDate: '2026-11-02',
      endDate: '2026-11-04',
      reason: 'Family trip',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ days: 3, status: 'PENDING', propertyId: P().MNL });
    const overlap = await reception.request('POST', '/api/v1/me/leave-requests', {
      leaveTypeId: HR().leaveTypes.SIL,
      startDate: '2026-11-04',
      endDate: '2026-11-05',
    });
    expect(overlap.status).toBe(409);
  });

  it('approval debits the ledger once, reports clashing shifts, and emails the employee', async () => {
    const pending = await john.get(`${mnl()}/leave-requests?status=PENDING`);
    const request = pending.body.items.find(
      (r: { employeeName: string }) => r.employeeName === 'Rey Reception',
    );
    const url = `${mnl()}/leave-requests/${request.id}/decision`;
    // Two approvers at once: exactly one wins.
    const [a, b] = await Promise.all([
      john.request('POST', url, { decision: 'APPROVE' }, ifMatch(request.version)),
      maria.request('POST', url, { decision: 'APPROVE' }, ifMatch(request.version)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, expect.any(Number)]);
    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    expect([409, 412]).toContain(loser.status);
    expect(winner.body.status).toBe('APPROVED');
    // The published 2026-11-02 shift clashes with the leave.
    expect(winner.body.conflictingShifts.map((s: { date: string }) => s.date)).toEqual([
      '2026-11-02',
    ]);
    expect(await balance(reception, 'VL')).toBe(7);

    const mail = await ctx.mailbox.latestFor('reception@abc.test', 'leave-decided');
    expect(mail?.data).toMatchObject({ decision: 'APPROVED', startDate: '2026-11-02' });
  });

  it('colleagues see approved leave as "Unavailable"; leave readers see the type', async () => {
    const range = 'from=2026-11-01&to=2026-11-07';
    const gm = await john.get(`${mnl()}/schedule?${range}`);
    expect(gm.body.unavailability).toContainEqual(
      expect.objectContaining({ employeeId: E('E003'), label: 'Vacation Leave' }),
    );
    // Give the housekeeper schedule.read (without leave.read) at MNL.
    const role = await admin.request('POST', '/api/v1/roles', {
      key: 'schedule_viewer',
      name: 'Schedule viewer',
      permissions: ['property.read', 'schedule.read'],
    });
    const members = await admin.get('/api/v1/members');
    const hkMembership = members.body.find(
      (m: { email: string }) => m.email === 'hk@abc.test',
    ).membershipId;
    const assigned = await admin.request(
      'POST',
      `/api/v1/members/${hkMembership}/role-assignments`,
      {
        roleId: role.body.id,
        propertyId: P().MNL,
      },
    );
    expect(assigned.status).toBe(201);
    const colleague = await hk.get(`${mnl()}/schedule?${range}`);
    expect(colleague.status).toBe(200);
    const entry = colleague.body.unavailability.find(
      (u: { employeeId: string }) => u.employeeId === E('E003'),
    );
    expect(entry.label).toBe('Unavailable');
    expect(JSON.stringify(colleague.body)).not.toContain('Vacation');
  });

  it('cancelling approved future leave gives the days back', async () => {
    const mine = await reception.get('/api/v1/me/leave');
    const approved = mine.body.requests.find((r: { status: string }) => r.status === 'APPROVED');
    const cancelled = await reception.request(
      'POST',
      `/api/v1/me/leave-requests/${approved.id}/cancel`,
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(await balance(reception, 'VL')).toBe(10);
    const ledger = (await reception.get('/api/v1/me/leave')).body.ledger;
    expect(
      ledger
        .map((e: { kind: string }) => e.kind)
        .slice(0, 2)
        .sort(),
    ).toEqual(['REVERSAL', 'USAGE']);
  });

  it('approvers cannot approve their own leave', async () => {
    const own = await maria.request('POST', '/api/v1/me/leave-requests', {
      leaveTypeId: HR().leaveTypes.SIL,
      startDate: '2026-12-10',
      endDate: '2026-12-10',
    });
    expect(own.status).toBe(201);
    const url = `${mnl()}/leave-requests/${own.body.id}/decision`;
    expect((await maria.request('POST', url, { decision: 'APPROVE' }, ifMatch(1))).status).toBe(
      403,
    );
    const rejected = await admin.request(
      'POST',
      url,
      { decision: 'REJECT', note: 'Peak season' },
      ifMatch(1),
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'Peak season',
      conflictingShifts: [],
    });
  });

  it('HR posts accruals and adjustments within scope; the ledger is append-only', async () => {
    const post = (client: TestClient, employee: string, days: number) =>
      client.request('POST', `/api/v1/employees/${E(employee)}/leave/entries`, {
        leaveTypeId: HR().leaveTypes.SIL,
        kind: 'ADJUSTMENT',
        days,
        effectiveDate: '2026-09-01',
        note: 'Test',
      });
    const ok = await post(maria, 'E004', 1.5);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(
      ok.body.balances.find((b: { leaveTypeCode: string }) => b.leaveTypeCode === 'SIL').days,
    ).toBe(6.5);
    expect((await post(maria, 'E007', 1)).status).toBe(404);
    expect((await post(john, 'E004', 1)).status).toBe(403);
    const negative = await post(maria, 'E004', -10);
    expect(negative.status).toBe(409);
    expect((await post(maria, 'E004', 0.25)).status).toBe(400);

    const app = createPrismaClient({ connectionString: testDatabaseUrls().app, maxConnections: 1 });
    try {
      const org = { organizationId: ctx.world.abc.organizationId, identityId: null };
      await expect(
        withDbContext(app, org, (tx) => tx.leaveLedgerEntry.deleteMany({})),
      ).rejects.toThrow(/permission denied|append-only/);
      // The cached balance equals the ledger sum for everyone.
      const drift = await withDbContext(
        app,
        org,
        (tx) =>
          tx.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM leave_balances b
          WHERE b.half_days <> (SELECT coalesce(sum(half_days), 0) FROM leave_ledger l
                                WHERE l.employee_id = b.employee_id AND l.leave_type_id = b.leave_type_id)`,
      );
      expect(Number(drift[0]!.n)).toBe(0);
    } finally {
      await app.$disconnect();
    }
  });
});

describe('birthdays', () => {
  it('show day and month of colleagues who share them, never the year', async () => {
    const res = await reception.get(`${mnl()}/birthdays`);
    expect(res.status).toBe(200);
    const names = res.body.items.map((b: { name: string }) => b.name);
    expect(names).toEqual(expect.arrayContaining(['John Reyes', 'Maria Santos', 'Rey Reception']));
    expect(names).not.toContain('Hana Housekeeper'); // hidden by choice
    expect(names).not.toContain('Faye Desk'); // works in Cebu
    for (const b of res.body.items)
      expect(Object.keys(b).sort()).toEqual(['day', 'employeeId', 'month', 'name']);
    // No birth year anywhere (employee ids are random UUIDs, so check the other fields only).
    for (const b of res.body.items) {
      expect(JSON.stringify([b.name, b.month, b.day])).not.toMatch(/19\d\d/);
    }
  });
});
