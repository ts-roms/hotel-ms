/**
 * HR rules the database enforces on its own (blueprint §7.4, §13), and the catalog step
 * that gives existing organizations newly added role templates.
 */
import { ROLE_TEMPLATES } from '@hotel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMissingTemplateRoles } from '../src/catalog.js';
import { createPrismaClient, withDbContext, type PrismaClient } from '../src/index.js';
import { prepareTestDatabase, testDatabaseUrls } from '../src/testing.js';
import type { DemoWorld } from '../src/demo-world.js';

let world: DemoWorld;
let app: PrismaClient;
let system: PrismaClient;

beforeAll(async () => {
  world = await prepareTestDatabase();
  const urls = testDatabaseUrls();
  app = createPrismaClient({ connectionString: urls.app, maxConnections: 2 });
  system = createPrismaClient({ connectionString: urls.system, maxConnections: 1 });
}, 120_000);

afterAll(async () => {
  await Promise.all([app?.$disconnect(), system?.$disconnect()]);
});

const abc = () => ({ organizationId: world.abc.organizationId, identityId: null });
const xyz = () => ({ organizationId: world.xyz.organizationId, identityId: null });
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('shifts', () => {
  it('an employee cannot be in two shifts at once, even by direct SQL', async () => {
    const base = {
      organizationId: world.abc.organizationId,
      propertyId: world.abc.properties.MNL,
      employeeId: world.hr.abc.employees.E006!,
      departmentId: world.hr.abc.departments.HK!,
      shiftDate: d('2026-12-01'),
      breakMinutes: 0,
    };
    await withDbContext(app, abc(), (tx) =>
      tx.shift.create({
        data: {
          ...base,
          startsAt: new Date('2026-12-01T00:00:00Z'),
          endsAt: new Date('2026-12-01T08:00:00Z'),
        },
      }),
    );
    await expect(
      withDbContext(app, abc(), (tx) =>
        tx.shift.create({
          data: {
            ...base,
            startsAt: new Date('2026-12-01T07:00:00Z'),
            endsAt: new Date('2026-12-01T09:00:00Z'),
          },
        }),
      ),
    ).rejects.toThrow(/shifts_no_overlap/);
    // A cancelled shift frees the time.
    await expect(
      withDbContext(app, abc(), (tx) =>
        tx.shift.create({
          data: {
            ...base,
            status: 'CANCELLED',
            startsAt: new Date('2026-12-01T07:00:00Z'),
            endsAt: new Date('2026-12-01T09:00:00Z'),
          },
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe('leave ledger', () => {
  it('keeps the cached balance equal to the ledger and enforces signs', async () => {
    const employeeId = world.hr.abc.employees.E006!;
    const leaveTypeId = world.hr.abc.leaveTypes.SL!;
    const entry = (kind: 'ACCRUAL' | 'USAGE' | 'ADJUSTMENT', halfDays: number) =>
      withDbContext(app, abc(), (tx) =>
        tx.leaveLedgerEntry.create({
          data: {
            organizationId: world.abc.organizationId,
            employeeId,
            leaveTypeId,
            kind,
            halfDays,
            effectiveDate: d('2026-06-01'),
          },
        }),
      );
    await entry('ADJUSTMENT', 3);
    await expect(entry('ACCRUAL', -2)).rejects.toThrow(/leave_ledger_sign/);
    // A usage must point at a leave request.
    await expect(entry('USAGE', -2)).rejects.toThrow(/leave_ledger_request_link/);

    const { balance, sum } = await withDbContext(app, abc(), async (tx) => ({
      balance: await tx.leaveBalance.findUniqueOrThrow({
        where: { employeeId_leaveTypeId: { employeeId, leaveTypeId } },
      }),
      sum: await tx.leaveLedgerEntry.aggregate({
        where: { employeeId, leaveTypeId },
        _sum: { halfDays: true },
      }),
    }));
    expect(balance.halfDays).toBe(sum._sum.halfDays);
    expect(balance.halfDays).toBe(7 * 2 + 3);
  });
});

describe('employment assignments', () => {
  it('cannot overlap at one property', async () => {
    const hr = world.hr.abc;
    await expect(
      withDbContext(app, abc(), (tx) =>
        tx.employmentAssignment.create({
          data: {
            organizationId: world.abc.organizationId,
            employeeId: hr.employees.E003!,
            propertyId: world.abc.properties.MNL,
            departmentId: hr.departments.FO!,
            startDate: d('2026-06-01'),
          },
        }),
      ),
    ).rejects.toThrow(/employment_assignments_no_overlap/);
  });
});

describe('role templates added after an organization was provisioned', () => {
  it('are created for existing organizations, once, without touching custom roles', async () => {
    const hrTemplate = ROLE_TEMPLATES.find((t) => t.key === 'hr_manager')!;
    const removeHrRole = () =>
      withDbContext(app, xyz(), async (tx) => {
        const role = await tx.role.findFirst({ where: { key: 'hr_manager' } });
        if (!role) return;
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.role.delete({ where: { id: role.id } });
      });

    await removeHrRole();
    expect(await addMissingTemplateRoles(system, app)).toBe(1);
    expect(await addMissingTemplateRoles(system, app)).toBe(0);
    const recreated = await withDbContext(app, xyz(), (tx) =>
      tx.role.findFirstOrThrow({ where: { key: 'hr_manager' }, include: { permissions: true } }),
    );
    expect(recreated.templateKey).toBe('hr_manager');
    expect(recreated.permissions.map((p) => p.permissionCode).sort()).toEqual(
      [...hrTemplate.permissions].sort(),
    );

    // An organization's own role with the same key is left alone.
    await removeHrRole();
    await withDbContext(app, xyz(), (tx) =>
      tx.role.create({
        data: { organizationId: world.xyz.organizationId, key: 'hr_manager', name: 'Our HR' },
      }),
    );
    expect(await addMissingTemplateRoles(system, app)).toBe(0);
    const custom = await withDbContext(app, xyz(), (tx) =>
      tx.role.findFirstOrThrow({ where: { key: 'hr_manager' } }),
    );
    expect(custom).toMatchObject({ name: 'Our HR', templateKey: null });
  });
});
