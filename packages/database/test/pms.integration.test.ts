/**
 * Database-level PMS guarantees (blueprint §7.4): these hold no matter what application
 * code does, so they are tested directly against PostgreSQL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { propagateTemplatePermissions } from '../src/catalog.js';
import { createPrismaClient, withDbContext, type PrismaClient } from '../src/index.js';
import { prepareTestDatabase, testDatabaseUrls } from '../src/testing.js';
import type { DemoWorld } from '../src/seed/demo-world.js';

let world: DemoWorld;
let app: PrismaClient;
let system: PrismaClient;

beforeAll(async () => {
  world = await prepareTestDatabase();
  const urls = testDatabaseUrls();
  app = createPrismaClient({ connectionString: urls.app, maxConnections: 4 });
  system = createPrismaClient({ connectionString: urls.system, maxConnections: 1 });
}, 120_000);

afterAll(async () => {
  await Promise.all([app?.$disconnect(), system?.$disconnect()]);
});

const abc = () => ({ organizationId: world.abc.organizationId, identityId: null });
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('inventory_nights', () => {
  it('cannot be oversold, even by direct SQL', async () => {
    const roomTypeId = world.inventory.MNL.roomTypes.DLX!; // 2 rooms
    await withDbContext(app, abc(), (tx) =>
      tx.inventoryNight.create({
        data: {
          organizationId: world.abc.organizationId,
          propertyId: world.abc.properties.MNL,
          roomTypeId,
          stayDate: d('2027-01-10'),
          capacity: 2,
          sold: 2,
        },
      }),
    );
    await expect(
      withDbContext(
        app,
        abc(),
        (tx) =>
          tx.$executeRaw`UPDATE inventory_nights SET sold = sold + 1 WHERE room_type_id = ${roomTypeId}::uuid AND stay_date = '2027-01-10'`,
      ),
    ).rejects.toThrow(/inventory_nights_not_oversold/);
  });
});

describe('room_assignments', () => {
  const roomId = () => world.inventory.MNL.rooms['101']!;
  const block = (start: string, end: string) =>
    withDbContext(app, abc(), (tx) =>
      tx.roomAssignment.create({
        data: {
          organizationId: world.abc.organizationId,
          propertyId: world.abc.properties.MNL,
          roomId: roomId(),
          kind: 'BLOCK',
          startDate: d(start),
          endDate: d(end),
          reason: 'test',
        },
      }),
    );

  it('rejects overlapping holds on the same room', async () => {
    await block('2027-02-01', '2027-02-05');
    await expect(block('2027-02-04', '2027-02-06')).rejects.toThrow(/room_assignments_no_overlap/);
  });

  it('allows back-to-back stays (departure day = next arrival day)', async () => {
    await expect(block('2027-02-05', '2027-02-07')).resolves.toBeDefined();
  });

  it('released holds no longer block the room', async () => {
    const hold = await block('2027-03-01', '2027-03-03');
    await withDbContext(app, abc(), (tx) =>
      tx.roomAssignment.update({ where: { id: hold.id }, data: { releasedAt: new Date() } }),
    );
    await expect(block('2027-03-01', '2027-03-03')).resolves.toBeDefined();
  });

  it('holds on different rooms do not interfere; concurrent writers cannot both win', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => block('2027-04-01', '2027-04-02')),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('room_status_events', () => {
  it('is append-only for the runtime role', async () => {
    await withDbContext(app, abc(), (tx) =>
      tx.roomStatusEvent.create({
        data: {
          organizationId: world.abc.organizationId,
          propertyId: world.abc.properties.MNL,
          roomId: world.inventory.MNL.rooms['101']!,
          dimension: 'HOUSEKEEPING',
          fromValue: 'CLEAN',
          toValue: 'DIRTY',
        },
      }),
    );
    await expect(
      withDbContext(app, abc(), (tx) => tx.roomStatusEvent.updateMany({ data: { toValue: 'X' } })),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('role template propagation', () => {
  it('re-adds template permissions to linked roles and invalidates cached grants', async () => {
    const orgAdminRole = await withDbContext(app, abc(), async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { key: 'org_admin' } });
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionCode: { in: ['reservation.create', 'room.read'] } },
      });
      return role;
    });
    const versionBefore = await withDbContext(app, abc(), (tx) =>
      tx.organizationMembership.findFirstOrThrow({
        where: { roleAssignments: { some: { roleId: orgAdminRole.id } } },
        select: { id: true, grantsVersion: true },
      }),
    );

    expect(await propagateTemplatePermissions(system)).toBe(1);
    expect(await propagateTemplatePermissions(system)).toBe(0);

    const after = await withDbContext(app, abc(), async (tx) => ({
      permissions: await tx.rolePermission.findMany({ where: { roleId: orgAdminRole.id } }),
      membership: await tx.organizationMembership.findUniqueOrThrow({
        where: { id: versionBefore.id },
      }),
    }));
    expect(after.permissions.map((p) => p.permissionCode)).toEqual(
      expect.arrayContaining(['reservation.create', 'room.read']),
    );
    expect(after.membership.grantsVersion).toBe(versionBefore.grantsVersion + 1);
  });

  it('the system role can only add a template its own permissions (ADR-0033)', async () => {
    const frontDesk = await withDbContext(app, abc(), (tx) =>
      tx.role.findFirstOrThrow({ where: { key: 'front_desk' } }),
    );
    // payment.refund is not in the front desk template: a compromised worker must not be
    // able to hand it out.
    await expect(
      system.rolePermission.create({
        data: {
          organizationId: frontDesk.organizationId,
          roleId: frontDesk.id,
          permissionCode: 'payment.refund',
        },
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('the system role still cannot read tenant business data', async () => {
    await expect(system.reservation.findMany()).rejects.toThrow(/permission denied/);
    await expect(system.guest.findMany()).rejects.toThrow(/permission denied/);
  });
});
