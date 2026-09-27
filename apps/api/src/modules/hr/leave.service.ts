import { Injectable } from '@nestjs/common';
import type {
  CreateLeaveRequest,
  CreateLeaveTypeRequest,
  DecisionRequest,
  EmployeeLeave,
  LeaveDecisionResult,
  LeaveLedgerPostRequest,
  LeaveRequest,
  LeaveRequestListQuery,
  LeaveType,
  Shift,
  UpdateLeaveTypeRequest,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { addDays, daysBetween, fromDbDate, toDbDate } from '../../common/dates.js';
import { isUniqueViolation } from '../../common/db-errors.js';
import { ProblemException, Problems } from '../../common/problem.js';
import { localToday } from '../../common/zoned-time.js';
import { TenantDb } from '../../infrastructure/database.js';
import { NotificationsQueue } from '../../infrastructure/queue.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { invalidState } from '../pms/reservations.service.js';
import { activeOn, employeeName, HrAccess } from './hr-access.js';
import { toShiftDto } from './schedule.service.js';

const insufficientBalance = (detail: string) =>
  new ProblemException(409, 'INSUFFICIENT_LEAVE_BALANCE', 'Not enough leave', detail);

const days = (halfDays: number) => halfDays / 2;

const requestInclude = {
  employee: { select: { firstName: true, lastName: true, preferredName: true } },
  leaveType: { select: { code: true, name: true } },
} satisfies Prisma.LeaveRequestInclude;

type RequestRow = Prisma.LeaveRequestGetPayload<{ include: typeof requestInclude }>;

function toRequestDto(r: RequestRow): LeaveRequest {
  return {
    id: r.id,
    propertyId: r.propertyId,
    employeeId: r.employeeId,
    employeeName: employeeName(r.employee),
    leaveTypeId: r.leaveTypeId,
    leaveTypeCode: r.leaveType.code,
    leaveTypeName: r.leaveType.name,
    startDate: fromDbDate(r.startDate),
    endDate: fromDbDate(r.endDate),
    days: days(r.halfDays),
    reason: r.reason,
    status: r.status,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
    version: r.version,
  };
}

function toTypeDto(t: {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  allowNegative: boolean;
  minNoticeDays: number;
  archivedAt: Date | null;
}): LeaveType {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    paid: t.paid,
    allowNegative: t.allowNegative,
    minNoticeDays: t.minNoticeDays,
    archived: t.archivedAt !== null,
  };
}

@Injectable()
export class LeaveService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: HrAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsQueue,
  ) {}

  // ---- Leave types -------------------------------------------------------------------------

  async types(): Promise<LeaveType[]> {
    const rows = await this.db.run((tx) =>
      tx.leaveType.findMany({ orderBy: [{ archivedAt: 'desc' }, { name: 'asc' }] }),
    );
    return rows.map(toTypeDto);
  }

  async createType(input: CreateLeaveTypeRequest): Promise<LeaveType> {
    try {
      return await this.db.run(async (tx) => {
        const row = await tx.leaveType.create({
          data: { organizationId: this.access.organizationId, ...input },
        });
        await this.audit.record(tx, {
          action: 'leave_type.created',
          entityType: 'leave_type',
          entityId: row.id,
          after: input,
        });
        return toTypeDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw Problems.conflict(`Leave type ${input.code} exists.`);
      throw error;
    }
  }

  async updateType(id: string, input: UpdateLeaveTypeRequest): Promise<LeaveType> {
    return this.db.run(async (tx) => {
      const current = await tx.leaveType.findUnique({ where: { id } });
      if (!current) throw Problems.notFound('Leave type');
      const { archived, ...fields } = input;
      const row = await tx.leaveType.update({
        where: { id },
        data: {
          ...fields,
          ...(archived !== undefined
            ? { archivedAt: archived ? (current.archivedAt ?? new Date()) : null }
            : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'leave_type.updated',
        entityType: 'leave_type',
        entityId: id,
        before: toTypeDto(current),
        after: toTypeDto(row),
      });
      return toTypeDto(row);
    });
  }

  // ---- Balances and ledger -----------------------------------------------------------------

  private async leaveOf(tx: Tx, employeeId: string): Promise<EmployeeLeave> {
    const [balances, ledger, requests] = [
      await tx.leaveBalance.findMany({
        where: { employeeId },
        include: { leaveType: { select: { code: true, name: true } } },
        orderBy: { leaveType: { name: 'asc' } },
      }),
      await tx.leaveLedgerEntry.findMany({
        where: { employeeId },
        include: { leaveType: { select: { code: true } } },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      }),
      await tx.leaveRequest.findMany({
        where: { employeeId },
        include: requestInclude,
        orderBy: { startDate: 'desc' },
        take: 100,
      }),
    ];
    return {
      balances: balances.map((b) => ({
        leaveTypeId: b.leaveTypeId,
        leaveTypeCode: b.leaveType.code,
        leaveTypeName: b.leaveType.name,
        days: days(b.halfDays),
      })),
      ledger: ledger.map((e) => ({
        id: e.id,
        leaveTypeId: e.leaveTypeId,
        leaveTypeCode: e.leaveType.code,
        kind: e.kind,
        days: days(e.halfDays),
        effectiveDate: fromDbDate(e.effectiveDate),
        note: e.note,
        leaveRequestId: e.leaveRequestId,
        createdAt: e.createdAt.toISOString(),
      })),
      requests: requests.map(toRequestDto),
    };
  }

  async employeeLeave(employeeId: string): Promise<EmployeeLeave> {
    return this.db.run(async (tx) => {
      await this.access.requireEmployee(tx, 'leave.read', employeeId);
      return this.leaveOf(tx, employeeId);
    });
  }

  async myLeave(): Promise<EmployeeLeave> {
    return this.db.run(async (tx) => this.leaveOf(tx, (await this.access.myEmployee(tx)).id));
  }

  /** Locks the balance row (creating it at 0) and returns it, in half-days. */
  private async lockBalance(tx: Tx, employeeId: string, leaveTypeId: string): Promise<number> {
    await tx.$executeRaw`
      INSERT INTO leave_balances (organization_id, employee_id, leave_type_id, half_days, updated_at)
      VALUES (${this.access.organizationId}::uuid, ${employeeId}::uuid, ${leaveTypeId}::uuid, 0, now())
      ON CONFLICT (employee_id, leave_type_id) DO NOTHING`;
    const [row] = await tx.$queryRaw<{ half_days: number }[]>`
      SELECT half_days FROM leave_balances
      WHERE employee_id = ${employeeId}::uuid AND leave_type_id = ${leaveTypeId}::uuid
      FOR UPDATE`;
    return row!.half_days;
  }

  async postLedger(employeeId: string, input: LeaveLedgerPostRequest): Promise<EmployeeLeave> {
    return this.db.run(async (tx) => {
      await this.access.requireEmployee(tx, 'leave.read', employeeId);
      if (!(await this.access.coversEmployee(tx, 'leave.manage', employeeId))) {
        throw Problems.forbidden('Missing permission leave.manage');
      }
      const type = await tx.leaveType.findUnique({ where: { id: input.leaveTypeId } });
      if (!type)
        throw Problems.validation([{ path: 'leaveTypeId', message: 'Unknown leave type' }]);
      const halfDays = Math.round(input.days * 2);
      if (input.kind === 'ACCRUAL' && halfDays < 0) {
        throw Problems.validation([{ path: 'days', message: 'Accruals are positive' }]);
      }
      const balance = await this.lockBalance(tx, employeeId, type.id);
      if (!type.allowNegative && balance + halfDays < 0) {
        throw insufficientBalance(`The ${type.name} balance would drop below zero.`);
      }
      const entry = await tx.leaveLedgerEntry.create({
        data: {
          organizationId: this.access.organizationId,
          employeeId,
          leaveTypeId: type.id,
          kind: input.kind,
          halfDays,
          effectiveDate: toDbDate(input.effectiveDate),
          note: input.note,
          createdBy: this.access.actorId,
        },
      });
      await this.audit.record(tx, {
        action: 'leave.ledger_posted',
        entityType: 'employee',
        entityId: employeeId,
        after: { entryId: entry.id, leaveType: type.code, kind: input.kind, days: input.days },
      });
      return this.leaveOf(tx, employeeId);
    });
  }

  // ---- Requests ----------------------------------------------------------------------------

  async request(input: CreateLeaveRequest): Promise<LeaveRequest> {
    return this.db.run(async (tx) => {
      const me = await this.access.myEmployee(tx);
      const type = await tx.leaveType.findUnique({ where: { id: input.leaveTypeId } });
      if (!type || type.archivedAt) {
        throw Problems.validation([{ path: 'leaveTypeId', message: 'Unknown leave type' }]);
      }
      // Routed to the property the employee works at on the first day (primary first).
      const assignment = await tx.employmentAssignment.findFirst({
        where: { employeeId: me.id, ...activeOn(input.startDate) },
        include: { property: { select: { timezone: true } } },
        orderBy: { isPrimary: 'desc' },
      });
      if (!assignment) {
        throw Problems.validation([
          { path: 'startDate', message: 'You have no assignment on that date' },
        ]);
      }
      if (!this.access.has('leave.request.own', assignment.propertyId)) {
        throw Problems.forbidden('Missing permission leave.request.own');
      }
      const today = localToday(assignment.property.timezone);
      if (input.startDate < addDays(today, type.minNoticeDays)) {
        throw Problems.validation([
          {
            path: 'startDate',
            message:
              type.minNoticeDays > 0
                ? `${type.name} needs ${type.minNoticeDays} days' notice`
                : 'Cannot start in the past',
          },
        ]);
      }
      const overlapping = await tx.leaveRequest.count({
        where: {
          employeeId: me.id,
          status: { in: ['PENDING', 'APPROVED'] },
          startDate: { lte: toDbDate(input.endDate) },
          endDate: { gte: toDbDate(input.startDate) },
        },
      });
      if (overlapping) throw Problems.conflict('You already have leave on some of those days.');

      const halfDays = (daysBetween(input.startDate, input.endDate) + 1) * 2;
      if (!type.allowNegative) {
        const balance = await tx.leaveBalance.findUnique({
          where: { employeeId_leaveTypeId: { employeeId: me.id, leaveTypeId: type.id } },
        });
        const pending = await tx.leaveRequest.aggregate({
          where: { employeeId: me.id, leaveTypeId: type.id, status: 'PENDING' },
          _sum: { halfDays: true },
        });
        const available = (balance?.halfDays ?? 0) - (pending._sum.halfDays ?? 0);
        if (available < halfDays) {
          throw insufficientBalance(
            `You have ${days(available)} day(s) of ${type.name} available (after pending requests).`,
          );
        }
      }
      const row = await tx.leaveRequest.create({
        data: {
          organizationId: this.access.organizationId,
          propertyId: assignment.propertyId,
          employeeId: me.id,
          leaveTypeId: type.id,
          startDate: toDbDate(input.startDate),
          endDate: toDbDate(input.endDate),
          halfDays,
          reason: input.reason,
          requestedBy: this.access.actorId,
        },
        include: requestInclude,
      });
      await this.audit.record(tx, {
        action: 'leave.requested',
        entityType: 'leave_request',
        entityId: row.id,
        propertyId: row.propertyId,
        after: { leaveType: type.code, startDate: input.startDate, endDate: input.endDate },
      });
      await this.outbox.enqueue(
        tx,
        'LeaveRequested',
        { leaveRequestId: row.id, employeeId: me.id },
        { propertyId: row.propertyId },
      );
      return toRequestDto(row);
    });
  }

  /** Pending requests are withdrawn; approved ones before they start are given back. */
  async cancelMine(id: string): Promise<LeaveRequest> {
    return this.db.run(async (tx) => {
      const me = await this.access.myEmployee(tx);
      const current = await tx.leaveRequest.findFirst({
        where: { id, employeeId: me.id },
        include: { property: { select: { timezone: true } } },
      });
      if (!current) throw Problems.notFound('Leave request');
      const today = localToday(current.property.timezone);
      if (current.status === 'APPROVED' && fromDbDate(current.startDate) <= today) {
        throw invalidState('Leave that has started can only be changed by HR.');
      }
      if (current.status !== 'PENDING' && current.status !== 'APPROVED') {
        throw invalidState('The request is already closed.');
      }
      const { count } = await tx.leaveRequest.updateMany({
        where: { id, version: current.version },
        data: { status: 'CANCELLED', cancelledAt: new Date(), version: { increment: 1 } },
      });
      if (count !== 1) throw Problems.versionConflict();
      if (current.status === 'APPROVED') {
        await tx.leaveLedgerEntry.create({
          data: {
            organizationId: this.access.organizationId,
            employeeId: me.id,
            leaveTypeId: current.leaveTypeId,
            kind: 'REVERSAL',
            halfDays: current.halfDays,
            effectiveDate: current.startDate,
            leaveRequestId: id,
            note: 'Cancelled by employee',
            createdBy: this.access.actorId,
          },
        });
      }
      await this.audit.record(tx, {
        action: 'leave.cancelled',
        entityType: 'leave_request',
        entityId: id,
        propertyId: current.propertyId,
        before: { status: current.status },
      });
      await this.outbox.enqueue(
        tx,
        'LeaveCancelled',
        { leaveRequestId: id, employeeId: me.id },
        { propertyId: current.propertyId },
      );
      return toRequestDto(
        await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }),
      );
    });
  }

  async propertyRequests(
    propertyId: string,
    query: LeaveRequestListQuery,
  ): Promise<LeaveRequest[]> {
    const rows = await this.db.run((tx) =>
      tx.leaveRequest.findMany({
        where: { propertyId, ...(query.status ? { status: query.status } : {}) },
        include: requestInclude,
        orderBy: [{ startDate: 'asc' }],
        take: query.limit,
      }),
    );
    return rows.map(toRequestDto);
  }

  /**
   * Approve or reject (blueprint §13.4). The version predicate stops two approvers from
   * both acting; approval debits the ledger under the balance row lock and reports the
   * shifts that now clash with the leave.
   */
  async decide(
    propertyId: string,
    id: string,
    expectedVersion: number,
    input: DecisionRequest,
  ): Promise<LeaveDecisionResult> {
    const { result, mail } = await this.db.run(async (tx) => {
      const current = await tx.leaveRequest.findFirst({
        where: { id, propertyId },
        include: {
          ...requestInclude,
          employee: {
            select: {
              firstName: true,
              lastName: true,
              preferredName: true,
              workEmail: true,
              membership: { select: { identity: { select: { email: true } } } },
            },
          },
          leaveType: true,
        },
      });
      if (!current) throw Problems.notFound('Leave request');
      const me = await this.access.findMyEmployee(tx);
      if (me?.id === current.employeeId) {
        throw Problems.forbidden('You cannot decide your own leave request.');
      }
      if (current.status !== 'PENDING') throw invalidState('The request was already decided.');
      const status: 'APPROVED' | 'REJECTED' =
        input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const { count } = await tx.leaveRequest.updateMany({
        where: { id, version: expectedVersion, status: 'PENDING' },
        data: {
          status,
          decidedBy: this.access.actorId,
          decidedAt: new Date(),
          decisionNote: input.note || null,
          version: { increment: 1 },
        },
      });
      if (count !== 1) throw Problems.versionConflict();

      let conflicting: Shift[] = [];
      if (status === 'APPROVED') {
        const balance = await this.lockBalance(tx, current.employeeId, current.leaveTypeId);
        if (!current.leaveType.allowNegative && balance < current.halfDays) {
          throw insufficientBalance(
            `${employeeName(current.employee)} has ${days(balance)} day(s) of ${current.leaveType.name}.`,
          );
        }
        await tx.leaveLedgerEntry.create({
          data: {
            organizationId: this.access.organizationId,
            employeeId: current.employeeId,
            leaveTypeId: current.leaveTypeId,
            kind: 'USAGE',
            halfDays: -current.halfDays,
            effectiveDate: current.startDate,
            leaveRequestId: id,
            note: `${fromDbDate(current.startDate)} – ${fromDbDate(current.endDate)}`,
            createdBy: this.access.actorId,
          },
        });
        conflicting = await this.conflictingShifts(tx, current);
      }
      await this.audit.record(tx, {
        action: `leave.${status.toLowerCase()}`,
        entityType: 'leave_request',
        entityId: id,
        propertyId,
        after: { status, note: input.note },
      });
      await this.outbox.enqueue(
        tx,
        status === 'APPROVED' ? 'LeaveApproved' : 'LeaveRejected',
        status === 'APPROVED'
          ? {
              leaveRequestId: id,
              employeeId: current.employeeId,
              conflictingShiftIds: conflicting.map((s) => s.id),
            }
          : { leaveRequestId: id, employeeId: current.employeeId },
        { propertyId },
      );
      const row = await tx.leaveRequest.findUniqueOrThrow({
        where: { id },
        include: requestInclude,
      });
      const recipient = current.employee.membership?.identity.email ?? current.employee.workEmail;
      return {
        result: { ...toRequestDto(row), conflictingShifts: conflicting },
        mail: recipient
          ? {
              to: recipient,
              data: {
                employeeName: current.employee.preferredName || current.employee.firstName,
                leaveTypeName: current.leaveType.name,
                startDate: fromDbDate(current.startDate),
                endDate: fromDbDate(current.endDate),
                decision: status,
                note: input.note,
              },
            }
          : null,
      };
    });
    if (mail) await this.notifications.sendEmail({ template: 'leave-decided', ...mail });
    return result;
  }

  private async conflictingShifts(
    tx: Tx,
    request: { employeeId: string; startDate: Date; endDate: Date },
  ) {
    const rows = await tx.shift.findMany({
      where: {
        employeeId: request.employeeId,
        status: { not: 'CANCELLED' },
        shiftDate: { gte: request.startDate, lte: request.endDate },
      },
      include: {
        employee: { select: { firstName: true, lastName: true, preferredName: true } },
        department: { select: { name: true } },
        property: { select: { timezone: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((s) => toShiftDto(s, s.property.timezone));
  }
}
