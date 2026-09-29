import { Injectable } from '@nestjs/common';
import type {
  DayStats,
  FnbReport,
  GuestServiceReport,
  HrReport,
  OccupancyReport,
  OrganizationDashboard,
  PermissionCode,
  PropertyDashboard,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { addDays, fromDbDate, toDbDate } from '../../common/dates.js';
import { toMinor } from '../../common/money.js';
import type { RequestContext } from '../../common/request-context.js';
import { fromLocal, localToday } from '../../common/zoned-time.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AttendanceService } from '../hr/time/attendance.service.js';

const signed = (v: bigint | null | undefined) => {
  const n = v ?? 0n;
  return n < 0n ? -toMinor(-n) : toMinor(n);
};
const ratio = (num: bigint, den: number) =>
  den === 0 ? 0 : toMinor((num * 2n + BigInt(den)) / (2n * BigInt(den)));
const pct = (num: number, den: number) => (den === 0 ? 0 : Math.round((num / den) * 1000) / 10);

/** The part of a night-audit closing's stored stats the occupancy report reads. */
type ClosingStats = Pick<
  DayStats,
  'roomsAvailable' | 'roomsSold' | 'roomRevenueMinor' | 'arrivals' | 'departures' | 'noShows'
>;

/**
 * Dashboards and reports (spec §41–42, §66–67, ADR-0025). Read-only; every section is
 * computed only for properties where the caller holds the permission guarding its data.
 */
@Injectable()
export class ManagementService {
  constructor(
    private readonly db: TenantDb,
    private readonly attendance: AttendanceService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private can(permission: PermissionCode, propertyId: string): boolean {
    return this.cls.get('grants')!.hasForProperty(permission, propertyId);
  }

  /** Net revenue (charges and their corrections, no taxes) between two business dates. */
  private async revenue(tx: Tx, propertyId: string, from: string, to: string): Promise<bigint> {
    const [row] = await tx.$queryRaw<{ net: bigint | null }[]>`
      SELECT sum(amount_minor)::bigint AS net FROM folio_lines
      WHERE property_id = ${propertyId}::uuid
        AND business_date BETWEEN ${toDbDate(from)} AND ${toDbDate(to)}
        AND type::text IN ('CHARGE', 'ADJUSTMENT', 'REVERSAL') AND tax_code IS NULL`;
    return row?.net ?? 0n;
  }

  /** Rooms in house now, sellable rooms today (active minus out of order). */
  private async roomsNow(tx: Tx, propertyId: string, businessDate: string) {
    const day = toDbDate(businessDate);
    const total = await tx.room.count({ where: { propertyId, archivedAt: null } });
    const outOfOrder = await tx.roomAssignment.count({
      where: {
        propertyId,
        kind: 'BLOCK',
        releasedAt: null,
        startDate: { lte: day },
        endDate: { gt: day },
      },
    });
    const occupied = await tx.reservationRoom.count({ where: { propertyId, status: 'IN_HOUSE' } });
    return { total, outOfOrder, occupied, sellable: Math.max(0, total - outOfOrder) };
  }

  // ---- Property dashboard -------------------------------------------------------------------

  async propertyDashboard(propertyId: string): Promise<PropertyDashboard> {
    const base = await this.db.run(async (tx) => {
      const property = await tx.property.findUniqueOrThrow({ where: { id: propertyId } });
      const businessDate = fromDbDate(property.currentBusinessDate);
      const day = toDbDate(businessDate);
      const today = localToday(property.timezone);

      let rooms: PropertyDashboard['rooms'] = null;
      if (this.can('reservation.read', propertyId)) {
        const now = await this.roomsNow(tx, propertyId, businessDate);
        const lines = (status: Prisma.ReservationRoomWhereInput) =>
          tx.reservationRoom.count({ where: { propertyId, ...status } });
        rooms = {
          total: now.total,
          occupied: now.occupied,
          outOfOrder: now.outOfOrder,
          occupancyPct: pct(now.occupied, now.sellable),
          arrivalsExpected: await lines({
            arrivalDate: day,
            status: { in: ['RESERVED', 'IN_HOUSE'] },
          }),
          arrivalsCheckedIn: await lines({ arrivalDate: day, status: 'IN_HOUSE' }),
          departuresExpected: await lines({
            departureDate: day,
            status: { in: ['IN_HOUSE', 'CHECKED_OUT'] },
          }),
          departuresCheckedOut: await lines({ departureDate: day, status: 'CHECKED_OUT' }),
          reservationsMadeToday: await tx.reservation.count({
            where: {
              propertyId,
              createdAt: {
                gte: fromLocal(today, '00:00', property.timezone),
                lt: fromLocal(addDays(today, 1), '00:00', property.timezone),
              },
            },
          }),
        };
      }

      const revenue = this.can('finance.report.read', propertyId)
        ? {
            todayMinor: signed(await this.revenue(tx, propertyId, businessDate, businessDate)),
            monthToDateMinor: signed(
              await this.revenue(tx, propertyId, `${businessDate.slice(0, 8)}01`, businessDate),
            ),
          }
        : null;

      let operations: PropertyDashboard['operations'] = null;
      if (this.can('housekeeping.read', propertyId) || this.can('maintenance.read', propertyId)) {
        operations = {
          dirtyRooms: await tx.room.count({
            where: { propertyId, archivedAt: null, housekeepingStatus: 'DIRTY' },
          }),
          openMaintenance: await tx.maintenanceRequest.count({
            where: { propertyId, status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] } },
          }),
          urgentMaintenance: await tx.maintenanceRequest.count({
            where: {
              propertyId,
              priority: 'URGENT',
              status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] },
            },
          }),
          openGuestRequests: await tx.serviceRequest.count({
            where: { propertyId, status: { in: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] } },
          }),
          activeFoodOrders: await tx.order.count({
            where: {
              propertyId,
              status: { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] },
            },
          }),
        };
      }

      let hr: PropertyDashboard['hr'] = null;
      if (this.can('leave.approve', propertyId) || this.can('employee.read', propertyId)) {
        const employees = await tx.employee.findMany({
          where: {
            status: 'ACTIVE',
            birthDate: { not: null },
            birthdayVisibility: { not: 'HIDDEN' },
            assignments: {
              some: {
                propertyId,
                startDate: { lte: toDbDate(today) },
                OR: [{ endDate: null }, { endDate: { gte: toDbDate(today) } }],
              },
            },
          },
          select: { firstName: true, lastName: true, preferredName: true, birthDate: true },
        });
        hr = {
          pendingLeaveRequests: await tx.leaveRequest.count({
            where: { propertyId, status: 'PENDING' },
          }),
          birthdaysToday: employees
            .filter((e) => fromDbDate(e.birthDate!).slice(5) === today.slice(5))
            .map((e) => `${e.preferredName || e.firstName} ${e.lastName}`),
        };
      }
      return { property, businessDate, today, rooms, revenue, operations, hr };
    });

    let staff: PropertyDashboard['staff'] = null;
    if (this.can('attendance.read', propertyId)) {
      const days = await this.attendance.propertyAttendance(propertyId, base.today, base.today);
      staff = {
        scheduled: days.filter((d) => d.shift !== null).length,
        present: days.filter((d) => d.status === 'PRESENT' || d.status === 'INCOMPLETE').length,
        late: days.filter((d) => d.lateMinutes > 0).length,
        absent: days.filter((d) => d.status === 'ABSENT').length,
        onLeave: days.filter((d) => d.status === 'ON_LEAVE').length,
      };
    }

    return {
      propertyId,
      propertyName: base.property.name,
      businessDate: base.businessDate,
      currency: base.property.currency,
      rooms: base.rooms,
      revenue: base.revenue,
      staff,
      operations: base.operations,
      hr: base.hr,
    };
  }

  // ---- Organization dashboard ---------------------------------------------------------------

  async organizationDashboard(): Promise<OrganizationDashboard> {
    const grants = this.cls.get('grants')!;
    const scope = grants.propertyScope('property.read');
    return this.db.run(async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: this.cls.get('organizationId')! },
        select: { name: true },
      });
      const properties = await tx.property.findMany({
        where: {
          status: { not: 'INACTIVE' },
          ...(scope.kind === 'some' ? { id: { in: scope.propertyIds } } : {}),
        },
        orderBy: { name: 'asc' },
      });
      const rows: OrganizationDashboard['properties'] = [];
      for (const p of properties) {
        const businessDate = fromDbDate(p.currentBusinessDate);
        const today = localToday(p.timezone);
        const rooms = this.can('reservation.read', p.id)
          ? await this.roomsNow(tx, p.id, businessDate)
          : null;
        const finance = this.can('finance.report.read', p.id);
        rows.push({
          propertyId: p.id,
          name: p.name,
          code: p.code,
          currency: p.currency,
          businessDate,
          occupancyPct: rooms ? pct(rooms.occupied, rooms.sellable) : null,
          occupiedRooms: rooms?.occupied ?? null,
          totalRooms: rooms?.sellable ?? null,
          revenueTodayMinor: finance
            ? signed(await this.revenue(tx, p.id, businessDate, businessDate))
            : null,
          revenueMonthToDateMinor: finance
            ? signed(await this.revenue(tx, p.id, `${businessDate.slice(0, 8)}01`, businessDate))
            : null,
          headcount: this.can('employee.read', p.id)
            ? await tx.employee.count({
                where: {
                  status: 'ACTIVE',
                  assignments: {
                    some: {
                      propertyId: p.id,
                      startDate: { lte: toDbDate(today) },
                      OR: [{ endDate: null }, { endDate: { gte: toDbDate(today) } }],
                    },
                  },
                },
              })
            : null,
        });
      }
      const withRooms = rows.filter((r) => r.totalRooms !== null);
      const withMoney = rows.filter((r) => r.revenueTodayMinor !== null);
      const currencies = new Set(withMoney.map((r) => r.currency));
      const oneCurrency = currencies.size === 1 ? [...currencies][0]! : null;
      const occupied = withRooms.reduce((s, r) => s + (r.occupiedRooms ?? 0), 0);
      const total = withRooms.reduce((s, r) => s + (r.totalRooms ?? 0), 0);
      return {
        organizationName: organization.name,
        properties: rows,
        totals: {
          occupancyPct: withRooms.length ? pct(occupied, total) : null,
          occupiedRooms: occupied,
          totalRooms: total,
          currency: oneCurrency,
          revenueTodayMinor: oneCurrency
            ? withMoney.reduce((s, r) => s + (r.revenueTodayMinor ?? 0), 0)
            : null,
          revenueMonthToDateMinor: oneCurrency
            ? withMoney.reduce((s, r) => s + (r.revenueMonthToDateMinor ?? 0), 0)
            : null,
          // Employees working at several properties count once per property.
          headcount: rows.reduce((s, r) => s + (r.headcount ?? 0), 0),
        },
      };
    });
  }

  // ---- Reports ------------------------------------------------------------------------------

  async occupancy(propertyId: string, from: string, to: string): Promise<OccupancyReport> {
    return this.db.run(async (tx) => {
      const property = await tx.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { currency: true, timezone: true },
      });
      const closings = await tx.businessDayClosing.findMany({
        where: { propertyId, businessDate: { gte: toDbDate(from), lte: toDbDate(to) } },
        orderBy: { businessDate: 'asc' },
      });
      const days = closings.map((c) => {
        const s = c.stats as ClosingStats;
        return {
          date: fromDbDate(c.businessDate),
          roomsAvailable: s.roomsAvailable,
          roomsSold: s.roomsSold,
          occupancyPct: pct(s.roomsSold, s.roomsAvailable),
          roomRevenueMinor: s.roomRevenueMinor,
          adrMinor: ratio(BigInt(s.roomRevenueMinor), s.roomsSold),
          revparMinor: ratio(BigInt(s.roomRevenueMinor), s.roomsAvailable),
          arrivals: s.arrivals,
          departures: s.departures,
          noShows: s.noShows,
        };
      });
      const available = days.reduce((s, d) => s + d.roomsAvailable, 0);
      const sold = days.reduce((s, d) => s + d.roomsSold, 0);
      const revenue = days.reduce((s, d) => s + BigInt(d.roomRevenueMinor), 0n);
      const window = {
        gte: fromLocal(from, '00:00', property.timezone),
        lt: fromLocal(addDays(to, 1), '00:00', property.timezone),
      };
      return {
        currency: property.currency,
        days,
        totals: {
          roomsAvailable: available,
          roomsSold: sold,
          occupancyPct: pct(sold, available),
          roomRevenueMinor: toMinor(revenue),
          adrMinor: ratio(revenue, sold),
          revparMinor: ratio(revenue, available),
          cancellations: await tx.reservation.count({
            where: { propertyId, cancelledAt: window },
          }),
          reservationsMade: await tx.reservation.count({
            where: { propertyId, createdAt: window },
          }),
        },
        closedDays: days.length,
      };
    });
  }

  async hr(propertyId: string, from: string, to: string): Promise<HrReport> {
    const days = await this.attendance.propertyAttendance(propertyId, from, to);
    return this.db.run(async (tx) => {
      const assignments = await tx.employmentAssignment.findMany({
        where: {
          propertyId,
          startDate: { lte: toDbDate(to) },
          OR: [{ endDate: null }, { endDate: { gte: toDbDate(to) } }],
          employee: { status: 'ACTIVE' },
        },
        select: { employeeId: true, department: { select: { name: true } } },
      });
      const byDepartment = new Map<string, Set<string>>();
      for (const a of assignments) {
        const set = byDepartment.get(a.department.name) ?? new Set<string>();
        set.add(a.employeeId);
        byDepartment.set(a.department.name, set);
      }
      const leave = await tx.leaveRequest.findMany({
        where: {
          propertyId,
          status: 'APPROVED',
          startDate: { lte: toDbDate(to) },
          endDate: { gte: toDbDate(from) },
        },
        select: { halfDays: true, leaveType: { select: { name: true } } },
      });
      const byType = new Map<string, { days: number; requests: number }>();
      for (const l of leave) {
        const entry = byType.get(l.leaveType.name) ?? { days: 0, requests: 0 };
        entry.days += l.halfDays / 2;
        entry.requests += 1;
        byType.set(l.leaveType.name, entry);
      }
      const sum = (f: (d: (typeof days)[number]) => number) => days.reduce((s, d) => s + f(d), 0);
      return {
        headcount: new Set(assignments.map((a) => a.employeeId)).size,
        byDepartment: [...byDepartment]
          .map(([department, set]) => ({ department, headcount: set.size }))
          .sort((a, b) => a.department.localeCompare(b.department)),
        attendance: {
          present: days.filter((d) => d.status === 'PRESENT' || d.status === 'INCOMPLETE').length,
          late: days.filter((d) => d.lateMinutes > 0).length,
          absent: days.filter((d) => d.status === 'ABSENT').length,
          workedMinutes: sum((d) => d.workedMinutes),
          lateMinutes: sum((d) => d.lateMinutes),
          overtimeMinutes: sum((d) => d.overtimeMinutes),
          undertimeMinutes: sum((d) => d.undertimeMinutes),
        },
        leave: [...byType]
          .map(([leaveType, v]) => ({ leaveType, ...v }))
          .sort((a, b) => a.leaveType.localeCompare(b.leaveType)),
      };
    });
  }

  async fnb(propertyId: string, from: string, to: string): Promise<FnbReport> {
    return this.db.run(async (tx) => {
      const property = await tx.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { currency: true, timezone: true },
      });
      const window = {
        gte: fromLocal(from, '00:00', property.timezone),
        lt: fromLocal(addDays(to, 1), '00:00', property.timezone),
      };
      const orders = await tx.order.findMany({
        where: { propertyId, createdAt: window },
        select: {
          status: true,
          chargeMethod: true,
          totalMinor: true,
          outlet: { select: { name: true, roomService: true } },
          items: { select: { name: true, quantity: true, lineTotalMinor: true } },
        },
      });
      const sold = orders.filter((o) => o.status !== 'CANCELLED');
      const total = (list: typeof sold) => list.reduce((s, o) => s + o.totalMinor, 0n);
      const items = new Map<string, { quantity: number; sales: bigint }>();
      const outlets = new Map<string, { orders: number; sales: bigint }>();
      for (const o of sold) {
        for (const i of o.items) {
          const e = items.get(i.name) ?? { quantity: 0, sales: 0n };
          e.quantity += i.quantity;
          e.sales += i.lineTotalMinor;
          items.set(i.name, e);
        }
        const e = outlets.get(o.outlet.name) ?? { orders: 0, sales: 0n };
        e.orders += 1;
        e.sales += o.totalMinor;
        outlets.set(o.outlet.name, e);
      }
      return {
        currency: property.currency,
        orders: sold.length,
        cancelled: orders.length - sold.length,
        salesMinor: toMinor(total(sold)),
        roomServiceSalesMinor: toMinor(total(sold.filter((o) => o.outlet.roomService))),
        roomChargedMinor: toMinor(total(sold.filter((o) => o.chargeMethod === 'ROOM_CHARGE'))),
        averageOrderMinor: ratio(total(sold), sold.length),
        topItems: [...items]
          .map(([name, v]) => ({ name, quantity: v.quantity, salesMinor: toMinor(v.sales) }))
          .sort((a, b) => b.quantity - a.quantity || b.salesMinor - a.salesMinor)
          .slice(0, 10),
        byOutlet: [...outlets]
          .map(([outlet, v]) => ({ outlet, orders: v.orders, salesMinor: toMinor(v.sales) }))
          .sort((a, b) => b.salesMinor - a.salesMinor),
      };
    });
  }

  async guestServices(propertyId: string, from: string, to: string): Promise<GuestServiceReport> {
    return this.db.run(async (tx) => {
      const property = await tx.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { timezone: true },
      });
      const requests = await tx.serviceRequest.findMany({
        where: {
          propertyId,
          createdAt: {
            gte: fromLocal(from, '00:00', property.timezone),
            lt: fromLocal(addDays(to, 1), '00:00', property.timezone),
          },
        },
        select: {
          category: true,
          status: true,
          createdAt: true,
          completedAt: true,
          rating: true,
        },
      });
      const minutes = (r: (typeof requests)[number]) =>
        r.completedAt ? (r.completedAt.getTime() - r.createdAt.getTime()) / 60_000 : null;
      const average = (values: (number | null)[]) => {
        const v = values.filter((x): x is number => x !== null);
        return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
      };
      const done = requests.filter((r) => r.status === 'DONE');
      const rated = requests.filter((r) => r.rating !== null);
      const categories = [...new Set(requests.map((r) => r.category))].sort();
      return {
        requests: requests.length,
        open: requests.filter((r) => !['DONE', 'CANCELLED'].includes(r.status)).length,
        completed: done.length,
        cancelled: requests.filter((r) => r.status === 'CANCELLED').length,
        averageCompletionMinutes: average(done.map(minutes)),
        averageRating: rated.length
          ? Math.round((rated.reduce((s, r) => s + r.rating!, 0) / rated.length) * 10) / 10
          : null,
        ratings: rated.length,
        byCategory: categories.map((category) => {
          const list = requests.filter((r) => r.category === category);
          return {
            category,
            requests: list.length,
            averageCompletionMinutes: average(list.filter((r) => r.status === 'DONE').map(minutes)),
          };
        }),
      };
    });
  }
}
