import { Injectable } from '@nestjs/common';
import type {
  CoverageGap,
  CreateStaffingRequirementRequest,
  StaffingRequirement,
} from '@hotel/contracts';
import type { Tx } from '@hotel/database';
import { addDays, fromDbDate, toDbDate } from '../../../common/dates.js';
import { Problems } from '../../../common/problem.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { HrAccess } from '../hr-access.js';
import { shiftInstants } from './schedule.service.js';

/** 0 = Sunday … 6 = Saturday, of a calendar date. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * The fewest people on shift at any moment of [start, end): shifts are clipped to the
 * window, and the count is taken on every segment between their starts and ends. So a
 * morning and an afternoon shift handing over at 14:00 cover a 06:00–22:00 window.
 */
export function minimumOnShift(
  shifts: { employeeId: string; startsAt: Date; endsAt: Date }[],
  start: Date,
  end: Date,
): number {
  const clipped = shifts
    .map((s) => ({
      employeeId: s.employeeId,
      from: Math.max(s.startsAt.getTime(), start.getTime()),
      to: Math.min(s.endsAt.getTime(), end.getTime()),
    }))
    .filter((s) => s.from < s.to);
  const points = [...new Set([start.getTime(), ...clipped.flatMap((s) => [s.from, s.to])])]
    .filter((p) => p >= start.getTime() && p < end.getTime())
    .sort((a, b) => a - b);
  let fewest = Infinity;
  for (const at of points) {
    const people = new Set(
      clipped.filter((s) => s.from <= at && s.to > at).map((s) => s.employeeId),
    );
    fewest = Math.min(fewest, people.size);
  }
  return fewest === Infinity ? 0 : fewest;
}

/**
 * Minimum staffing and understaffing detection (spec §35, ADR-0028). A requirement says a
 * department needs at least N people on shift at every moment of a local time window on
 * some weekdays. Draft and published shifts of that department count, except for people
 * on approved leave that day.
 */
@Injectable()
export class StaffingService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: HrAccess,
    private readonly audit: AuditService,
  ) {}

  async requirements(propertyId: string): Promise<StaffingRequirement[]> {
    const rows = await this.db.run((tx) =>
      tx.staffingRequirement.findMany({
        where: { propertyId, archivedAt: null },
        include: { department: { select: { name: true } } },
        orderBy: [{ department: { name: 'asc' } }, { startTime: 'asc' }],
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      departmentId: r.departmentId,
      departmentName: r.department.name,
      weekdays: [...r.weekdays].sort(),
      startTime: r.startTime,
      endTime: r.endTime,
      minStaff: r.minStaff,
    }));
  }

  async create(
    propertyId: string,
    input: CreateStaffingRequirementRequest,
  ): Promise<StaffingRequirement[]> {
    await this.db.run(async (tx) => {
      if (!(await tx.department.count({ where: { id: input.departmentId } })))
        throw Problems.validation([{ path: 'departmentId', message: 'Unknown department' }]);
      const row = await tx.staffingRequirement.create({
        data: {
          organizationId: this.access.organizationId,
          propertyId,
          ...input,
          createdBy: this.access.actorId,
        },
      });
      await this.audit.record(tx, {
        action: 'staffing_requirement.created',
        entityType: 'staffing_requirement',
        entityId: row.id,
        propertyId,
        after: input,
      });
    });
    return this.requirements(propertyId);
  }

  async archive(propertyId: string, id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const { count } = await tx.staffingRequirement.updateMany({
        where: { id, propertyId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      if (count !== 1) throw Problems.notFound('Staffing requirement');
      await this.audit.record(tx, {
        action: 'staffing_requirement.archived',
        entityType: 'staffing_requirement',
        entityId: id,
        propertyId,
      });
    });
  }

  async coverage(propertyId: string, from: string, to: string): Promise<CoverageGap[]> {
    return this.db.run((tx) => this.gapsInTx(tx, propertyId, from, to));
  }

  /** The requirement windows in [from, to] with fewer people than required. */
  async gapsInTx(tx: Tx, propertyId: string, from: string, to: string): Promise<CoverageGap[]> {
    const property = await this.access.property(tx, propertyId);
    const requirements = await tx.staffingRequirement.findMany({
      where: { propertyId, archivedAt: null },
      include: { department: { select: { name: true } } },
    });
    if (requirements.length === 0) return [];
    // Shifts starting the day before can cover an early-morning window.
    const shifts = await tx.shift.findMany({
      where: {
        propertyId,
        status: { not: 'CANCELLED' },
        departmentId: { in: requirements.map((r) => r.departmentId) },
        shiftDate: { gte: toDbDate(addDays(from, -1)), lte: toDbDate(to) },
      },
      select: {
        employeeId: true,
        departmentId: true,
        startsAt: true,
        endsAt: true,
        status: true,
      },
    });
    const leave = await tx.leaveRequest.findMany({
      where: {
        employeeId: { in: [...new Set(shifts.map((s) => s.employeeId))] },
        status: 'APPROVED',
        startDate: { lte: toDbDate(to) },
        endDate: { gte: toDbDate(from) },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    });
    const onLeave = (employeeId: string, date: string) =>
      leave.some(
        (l) =>
          l.employeeId === employeeId &&
          fromDbDate(l.startDate) <= date &&
          fromDbDate(l.endDate) >= date,
      );

    const gaps: CoverageGap[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const weekday = weekdayOf(date);
      for (const r of requirements) {
        if (!r.weekdays.includes(weekday)) continue;
        const window = shiftInstants(date, r.startTime, r.endTime, property.timezone);
        const working = shifts.filter(
          (s) =>
            s.departmentId === r.departmentId &&
            s.startsAt < window.endsAt &&
            s.endsAt > window.startsAt &&
            !onLeave(s.employeeId, date),
        );
        const scheduled = minimumOnShift(working, window.startsAt, window.endsAt);
        if (scheduled >= r.minStaff) continue;
        gaps.push({
          date,
          requirementId: r.id,
          departmentId: r.departmentId,
          departmentName: r.department.name,
          startTime: r.startTime,
          endTime: r.endTime,
          required: r.minStaff,
          scheduled,
          published: minimumOnShift(
            working.filter((s) => s.status === 'PUBLISHED'),
            window.startsAt,
            window.endsAt,
          ),
        });
      }
    }
    return gaps;
  }
}
