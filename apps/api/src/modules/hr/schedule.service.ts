import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateShiftRequest,
  CreateShiftTemplateRequest,
  Schedule,
  Shift,
  ShiftTemplate,
  ShiftWarning,
  ShiftWithWarnings,
  UpdateShiftRequest,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { addDays, fromDbDate, toDbDate } from '../../common/dates.js';
import { withConstraintMapping } from '../../common/db-errors.js';
import { Problems } from '../../common/problem.js';
import { fromLocal, toLocal } from '../../common/zoned-time.js';
import { ENV, type Env } from '../../config/env.js';
import { TenantDb } from '../../infrastructure/database.js';
import { NotificationsQueue } from '../../infrastructure/queue.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { invalidState } from '../pms/reservations.service.js';
import { activeOn, employeeName, HrAccess } from './hr-access.js';

/** Less rest than this between two shifts is flagged (configurable per org later). */
const MIN_REST_HOURS = 8;

const shiftInclude = {
  employee: { select: { firstName: true, lastName: true, preferredName: true } },
  department: { select: { name: true } },
} satisfies Prisma.ShiftInclude;

type ShiftRow = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>;

export function toShiftDto(s: ShiftRow, timeZone: string): Shift {
  return {
    id: s.id,
    employeeId: s.employeeId,
    employeeName: employeeName(s.employee),
    departmentId: s.departmentId,
    departmentName: s.department.name,
    date: fromDbDate(s.shiftDate),
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    startTime: toLocal(s.startsAt, timeZone).time,
    endTime: toLocal(s.endsAt, timeZone).time,
    breakMinutes: s.breakMinutes,
    status: s.status,
    notes: s.notes,
    version: s.version,
  };
}

/** Instants of a shift planned in local time; an end at or before the start is next day. */
export function shiftInstants(date: string, startTime: string, endTime: string, timeZone: string) {
  const startsAt = fromLocal(date, startTime, timeZone);
  const endsAt = fromLocal(endTime <= startTime ? addDays(date, 1) : date, endTime, timeZone);
  return { startsAt, endsAt };
}

@Injectable()
export class ScheduleService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: HrAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsQueue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---- Templates ---------------------------------------------------------------------------

  async templates(propertyId: string): Promise<ShiftTemplate[]> {
    const rows = await this.db.run((tx) =>
      tx.shiftTemplate.findMany({
        where: { propertyId, archivedAt: null },
        orderBy: { startTime: 'asc' },
      }),
    );
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      departmentId: t.departmentId,
      startTime: t.startTime,
      endTime: t.endTime,
      breakMinutes: t.breakMinutes,
    }));
  }

  async createTemplate(
    propertyId: string,
    input: CreateShiftTemplateRequest,
  ): Promise<ShiftTemplate[]> {
    if (input.startTime === input.endTime) {
      throw Problems.validation([{ path: 'endTime', message: 'Must differ from the start time' }]);
    }
    await this.db.run(async (tx) => {
      if (
        input.departmentId &&
        !(await tx.department.count({ where: { id: input.departmentId } }))
      ) {
        throw Problems.validation([{ path: 'departmentId', message: 'Unknown department' }]);
      }
      const row = await tx.shiftTemplate.create({
        data: { organizationId: this.access.organizationId, propertyId, ...input },
      });
      await this.audit.record(tx, {
        action: 'shift_template.created',
        entityType: 'shift_template',
        entityId: row.id,
        propertyId,
        after: input,
      });
    });
    return this.templates(propertyId);
  }

  async archiveTemplate(propertyId: string, id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const { count } = await tx.shiftTemplate.updateMany({
        where: { id, propertyId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      if (count !== 1) throw Problems.notFound('Shift template');
    });
  }

  // ---- Schedule ----------------------------------------------------------------------------

  async schedule(propertyId: string, from: string, to: string): Promise<Schedule> {
    return this.db.run(async (tx) => {
      const property = await this.access.property(tx, propertyId);
      const assignments = await tx.employmentAssignment.findMany({
        where: {
          propertyId,
          startDate: { lte: toDbDate(to) },
          OR: [{ endDate: null }, { endDate: { gte: toDbDate(from) } }],
          employee: { status: 'ACTIVE' },
        },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
          department: { select: { name: true } },
        },
        orderBy: [{ department: { name: 'asc' } }, { employee: { lastName: 'asc' } }],
      });
      const shifts = await tx.shift.findMany({
        where: {
          propertyId,
          shiftDate: { gte: toDbDate(from), lte: toDbDate(to) },
          status: { not: 'CANCELLED' },
        },
        include: shiftInclude,
        orderBy: { startsAt: 'asc' },
      });
      const employeeIds = assignments.map((a) => a.employeeId);
      const leave = await tx.leaveRequest.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: 'APPROVED',
          startDate: { lte: toDbDate(to) },
          endDate: { gte: toDbDate(from) },
        },
        include: { leaveType: { select: { name: true } } },
      });
      // Colleagues see "Unavailable"; the leave type only with leave.read (§13.5).
      const detailed = this.access.has('leave.read', propertyId);
      return {
        from,
        to,
        employees: assignments.map((a) => ({
          id: a.employee.id,
          name: employeeName(a.employee),
          departmentName: a.department.name,
        })),
        shifts: shifts.map((s) => toShiftDto(s, property.timezone)),
        unavailability: leave.map((l) => ({
          employeeId: l.employeeId,
          from: fromDbDate(l.startDate),
          to: fromDbDate(l.endDate),
          label: detailed ? l.leaveType.name : 'Unavailable',
        })),
      };
    });
  }

  private async warnings(
    tx: Tx,
    shift: { id?: string; employeeId: string; date: string; startsAt: Date; endsAt: Date },
  ): Promise<ShiftWarning[]> {
    const warnings: ShiftWarning[] = [];
    const onLeave = await tx.leaveRequest.findFirst({
      where: {
        employeeId: shift.employeeId,
        status: 'APPROVED',
        startDate: { lte: toDbDate(shift.date) },
        endDate: { gte: toDbDate(shift.date) },
      },
    });
    if (onLeave) {
      warnings.push({ code: 'ON_LEAVE', message: 'The employee is on approved leave that day.' });
    }
    const restMs = MIN_REST_HOURS * 3_600_000;
    const near = await tx.shift.findFirst({
      where: {
        employeeId: shift.employeeId,
        status: { not: 'CANCELLED' },
        ...(shift.id ? { id: { not: shift.id } } : {}),
        OR: [
          { endsAt: { gt: new Date(shift.startsAt.getTime() - restMs), lte: shift.startsAt } },
          { startsAt: { gte: shift.endsAt, lt: new Date(shift.endsAt.getTime() + restMs) } },
        ],
      },
    });
    if (near) {
      warnings.push({
        code: 'SHORT_REST',
        message: `Less than ${MIN_REST_HOURS} hours between this and another shift.`,
      });
    }
    return warnings;
  }

  async createShift(propertyId: string, input: CreateShiftRequest): Promise<ShiftWithWarnings> {
    return withConstraintMapping(() =>
      this.db.run(async (tx) => {
        const property = await this.access.property(tx, propertyId);
        const assignment = await tx.employmentAssignment.findFirst({
          where: {
            employeeId: input.employeeId,
            propertyId,
            ...activeOn(input.date),
            employee: { status: 'ACTIVE' },
          },
        });
        if (!assignment) {
          throw Problems.validation([
            { path: 'employeeId', message: 'Not assigned to this property on that date' },
          ]);
        }
        let { startTime, endTime, breakMinutes } = input;
        let departmentId = input.departmentId ?? assignment.departmentId;
        if (input.templateId) {
          const template = await tx.shiftTemplate.findFirst({
            where: { id: input.templateId, propertyId, archivedAt: null },
          });
          if (!template)
            throw Problems.validation([{ path: 'templateId', message: 'Unknown template' }]);
          startTime ??= template.startTime;
          endTime ??= template.endTime;
          breakMinutes ??= template.breakMinutes;
          departmentId = input.departmentId ?? template.departmentId ?? departmentId;
        }
        if (
          input.departmentId &&
          !(await tx.department.count({ where: { id: input.departmentId } }))
        ) {
          throw Problems.validation([{ path: 'departmentId', message: 'Unknown department' }]);
        }
        const { startsAt, endsAt } = shiftInstants(
          input.date,
          startTime!,
          endTime!,
          property.timezone,
        );
        const row = await tx.shift.create({
          data: {
            organizationId: this.access.organizationId,
            propertyId,
            employeeId: input.employeeId,
            departmentId,
            templateId: input.templateId,
            shiftDate: toDbDate(input.date),
            startsAt,
            endsAt,
            breakMinutes: breakMinutes ?? 0,
            notes: input.notes,
            createdBy: this.access.actorId,
          },
          include: shiftInclude,
        });
        await this.audit.record(tx, {
          action: 'shift.created',
          entityType: 'shift',
          entityId: row.id,
          propertyId,
          after: {
            employeeId: row.employeeId,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
        });
        const warnings = await this.warnings(tx, { ...row, date: input.date });
        return { ...toShiftDto(row, property.timezone), warnings };
      }),
    );
  }

  private async loadShift(tx: Tx, propertyId: string, id: string) {
    const shift = await tx.shift.findFirst({ where: { id, propertyId }, include: shiftInclude });
    if (!shift) throw Problems.notFound('Shift');
    return shift;
  }

  async updateShift(
    propertyId: string,
    id: string,
    expectedVersion: number,
    input: UpdateShiftRequest,
  ): Promise<ShiftWithWarnings> {
    return withConstraintMapping(() =>
      this.db.run(async (tx) => {
        const property = await this.access.property(tx, propertyId);
        const current = await this.loadShift(tx, propertyId, id);
        if (current.status === 'CANCELLED') throw invalidState('The shift is cancelled.');
        const date = fromDbDate(current.shiftDate);
        const startTime = input.startTime ?? toLocal(current.startsAt, property.timezone).time;
        const endTime = input.endTime ?? toLocal(current.endsAt, property.timezone).time;
        const { startsAt, endsAt } = shiftInstants(date, startTime, endTime, property.timezone);
        const { count } = await tx.shift.updateMany({
          where: { id, version: expectedVersion },
          data: {
            startsAt,
            endsAt,
            ...(input.breakMinutes !== undefined ? { breakMinutes: input.breakMinutes } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            version: { increment: 1 },
          },
        });
        if (count !== 1) throw Problems.versionConflict();
        const row = await this.loadShift(tx, propertyId, id);
        await this.audit.record(tx, {
          action: 'shift.updated',
          entityType: 'shift',
          entityId: id,
          propertyId,
          before: {
            startsAt: current.startsAt.toISOString(),
            endsAt: current.endsAt.toISOString(),
          },
          after: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        });
        if (current.status === 'PUBLISHED') {
          // The employee already saw this shift: tell them it changed.
          await this.outbox.enqueue(
            tx,
            'ShiftChanged',
            { shiftId: id, employeeId: row.employeeId, status: row.status },
            { propertyId },
          );
        }
        const warnings = await this.warnings(tx, { ...row, date });
        return { ...toShiftDto(row, property.timezone), warnings };
      }),
    );
  }

  async cancelShift(propertyId: string, id: string, expectedVersion: number): Promise<Shift> {
    return this.db.run(async (tx) => {
      const property = await this.access.property(tx, propertyId);
      const current = await this.loadShift(tx, propertyId, id);
      if (current.status === 'CANCELLED') throw invalidState('The shift is already cancelled.');
      const { count } = await tx.shift.updateMany({
        where: { id, version: expectedVersion },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      if (count !== 1) throw Problems.versionConflict();
      await this.audit.record(tx, {
        action: 'shift.cancelled',
        entityType: 'shift',
        entityId: id,
        propertyId,
        before: { status: current.status },
      });
      if (current.status === 'PUBLISHED') {
        await this.outbox.enqueue(
          tx,
          'ShiftChanged',
          { shiftId: id, employeeId: current.employeeId, status: 'CANCELLED' },
          { propertyId },
        );
      }
      return toShiftDto(await this.loadShift(tx, propertyId, id), property.timezone);
    });
  }

  /**
   * DRAFT → PUBLISHED for a date range (blueprint §13.3). Each affected employee is
   * emailed their shifts; the SchedulePublished event carries the shift ids.
   */
  async publish(propertyId: string, from: string, to: string): Promise<{ published: number }> {
    const { mails, count } = await this.db.run(async (tx) => {
      const property = await this.access.property(tx, propertyId);
      const drafts = await tx.shift.findMany({
        where: {
          propertyId,
          status: 'DRAFT',
          shiftDate: { gte: toDbDate(from), lte: toDbDate(to) },
        },
        include: {
          ...shiftInclude,
          employee: {
            select: {
              firstName: true,
              lastName: true,
              preferredName: true,
              workEmail: true,
              membership: { select: { identity: { select: { email: true } } } },
            },
          },
        },
        orderBy: { startsAt: 'asc' },
      });
      if (drafts.length === 0) return { mails: [], count: 0 };
      const ids = drafts.map((s) => s.id);
      await tx.shift.updateMany({
        where: { id: { in: ids } },
        data: { status: 'PUBLISHED', publishedAt: new Date(), version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'schedule.published',
        entityType: 'schedule',
        propertyId,
        after: { from, to, shifts: ids.length },
      });
      await this.outbox.enqueue(
        tx,
        'SchedulePublished',
        { from, to, shiftIds: ids },
        { propertyId },
      );

      const byEmployee = new Map<string, typeof drafts>();
      for (const s of drafts)
        byEmployee.set(s.employeeId, [...(byEmployee.get(s.employeeId) ?? []), s]);
      const mails = [...byEmployee.values()].flatMap((shifts) => {
        const employee = shifts[0]!.employee;
        const recipient = employee.membership?.identity.email ?? employee.workEmail;
        if (!recipient) return [];
        return [
          {
            recipient,
            data: {
              employeeName: employee.preferredName || employee.firstName,
              propertyName: property.name,
              from,
              to,
              shifts: shifts.map((s) => ({
                date: fromDbDate(s.shiftDate),
                startTime: toLocal(s.startsAt, property.timezone).time,
                endTime: toLocal(s.endsAt, property.timezone).time,
              })),
              scheduleUrl: `${this.env.APP_PUBLIC_URL}/me`,
            },
          },
        ];
      });
      return { mails, count: ids.length };
    });
    for (const mail of mails) {
      await this.notifications.sendEmail({
        template: 'schedule-published',
        to: mail.recipient,
        data: mail.data,
      });
    }
    return { published: count };
  }

  /** The caller's own published shifts, at every property. */
  async myShifts(from: string, to: string): Promise<Shift[]> {
    return this.db.run(async (tx) => {
      const me = await this.access.myEmployee(tx);
      const rows = await tx.shift.findMany({
        where: {
          employeeId: me.id,
          status: 'PUBLISHED',
          shiftDate: { gte: toDbDate(from), lte: toDbDate(to) },
        },
        include: { ...shiftInclude, property: { select: { timezone: true } } },
        orderBy: { startsAt: 'asc' },
      });
      return rows.map((s) => toShiftDto(s, s.property.timezone));
    });
  }
}
