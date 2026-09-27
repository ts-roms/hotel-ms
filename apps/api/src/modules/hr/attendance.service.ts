import { Injectable } from '@nestjs/common';
import type {
  AttendanceCorrection,
  AttendanceDay,
  CorrectionRequest,
  DecisionRequest,
  MyEmployee,
  Punch,
  PunchType,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { addDays, fromDbDate, toDbDate } from '../../common/dates.js';
import { Problems } from '../../common/problem.js';
import { fromLocal } from '../../common/zoned-time.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { invalidState } from '../pms/reservations.service.js';
import { computeAttendanceDays } from './attendance-rules.js';
import { employeeName, HrAccess, toEmployeeSummary } from './hr-access.js';

/** A shift left open longer than this no longer blocks clocking in (it shows incomplete). */
const STALE_OPEN_HOURS = 18;

/** Which punch may follow the last one. */
const NEXT: Record<PunchType | 'NONE', PunchType[]> = {
  NONE: ['IN'],
  OUT: ['IN'],
  IN: ['OUT', 'BREAK_START'],
  BREAK_START: ['BREAK_END'],
  BREAK_END: ['OUT', 'BREAK_START'],
};

export const toPunchDto = (p: {
  id: string;
  propertyId: string;
  type: PunchType;
  at: Date;
  source: Punch['source'];
}): Punch => ({
  id: p.id,
  propertyId: p.propertyId,
  type: p.type,
  at: p.at.toISOString(),
  source: p.source,
});

const correctionInclude = {
  employee: { select: { firstName: true, lastName: true, preferredName: true } },
} satisfies Prisma.AttendanceCorrectionInclude;

function toCorrectionDto(
  c: Prisma.AttendanceCorrectionGetPayload<{ include: typeof correctionInclude }>,
): AttendanceCorrection {
  return {
    id: c.id,
    propertyId: c.propertyId,
    employeeId: c.employeeId,
    employeeName: employeeName(c.employee),
    type: c.type,
    at: c.at.toISOString(),
    reason: c.reason,
    status: c.status,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    decisionNote: c.decisionNote,
    createdAt: c.createdAt.toISOString(),
    version: c.version,
  };
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: HrAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ---- Self service ------------------------------------------------------------------------

  async me(): Promise<MyEmployee> {
    return this.db.run(async (tx) => {
      const employee = await this.access.findMyEmployee(tx);
      if (!employee) return { employee: null, lastPunch: null };
      const last = await tx.attendancePunch.findFirst({
        where: { employeeId: employee.id },
        orderBy: [{ at: 'desc' }, { recordedAt: 'desc' }],
      });
      return { employee: toEmployeeSummary(employee), lastPunch: last ? toPunchDto(last) : null };
    });
  }

  /**
   * Records one punch after checking it may follow the last one. Punches of one employee
   * are serialized with a row lock on the employee, so two devices cannot both clock in.
   * Shared by the web punch and the time clock (ADR-0022).
   */
  async punchInTx(
    tx: Tx,
    input: {
      employeeId: string;
      propertyId: string;
      type: PunchType;
      source: Punch['source'];
      recordedBy: string | null;
    },
  ) {
    const { employeeId, propertyId, type } = input;
    await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
    const last = await tx.attendancePunch.findFirst({
      where: { employeeId },
      orderBy: [{ at: 'desc' }, { recordedAt: 'desc' }],
    });
    const now = new Date();
    const stale = last && now.getTime() - last.at.getTime() > STALE_OPEN_HOURS * 3_600_000;
    const state: PunchType | 'NONE' = !last || (stale && last.type !== 'OUT') ? 'NONE' : last.type;
    if (!NEXT[state].includes(type)) {
      throw invalidState(
        state === 'NONE' || state === 'OUT'
          ? 'You are not clocked in.'
          : `You cannot ${type.toLowerCase().replace('_', ' ')} now (last: ${state.toLowerCase().replace('_', ' ')}).`,
      );
    }
    if (last && type !== 'IN' && last.propertyId !== propertyId) {
      throw invalidState('You are clocked in at another property.');
    }
    const punch = await tx.attendancePunch.create({
      data: {
        organizationId: this.access.organizationId,
        propertyId,
        employeeId,
        type,
        at: now,
        source: input.source,
        recordedBy: input.recordedBy,
      },
    });
    if (type === 'IN' || type === 'OUT') {
      await this.outbox.enqueue(
        tx,
        type === 'IN' ? 'EmployeeClockedIn' : 'EmployeeClockedOut',
        { employeeId, punchId: punch.id },
        { propertyId },
      );
    }
    return punch;
  }

  async myAttendance(from: string, to: string): Promise<AttendanceDay[]> {
    return this.db.run(async (tx) => {
      const me = await this.access.myEmployee(tx);
      const assignments = await tx.employmentAssignment.findMany({
        where: {
          employeeId: me.id,
          startDate: { lte: toDbDate(to) },
          OR: [{ endDate: null }, { endDate: { gte: toDbDate(from) } }],
        },
        select: { propertyId: true },
        distinct: ['propertyId'],
      });
      const days: AttendanceDay[] = [];
      for (const { propertyId } of assignments) {
        days.push(...(await this.compute(tx, propertyId, from, to, [me.id])));
      }
      return days.sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  // ---- Property view -----------------------------------------------------------------------

  async propertyAttendance(propertyId: string, from: string, to: string): Promise<AttendanceDay[]> {
    return this.db.run(async (tx) => {
      const assignments = await tx.employmentAssignment.findMany({
        where: {
          propertyId,
          startDate: { lte: toDbDate(to) },
          OR: [{ endDate: null }, { endDate: { gte: toDbDate(from) } }],
        },
        select: { employeeId: true },
        distinct: ['employeeId'],
      });
      return this.compute(
        tx,
        propertyId,
        from,
        to,
        assignments.map((a) => a.employeeId),
      );
    });
  }

  private async compute(
    tx: Tx,
    propertyId: string,
    from: string,
    to: string,
    employeeIds: string[],
  ): Promise<AttendanceDay[]> {
    const property = await this.access.property(tx, propertyId);
    const employees = await tx.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, firstName: true, lastName: true, preferredName: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const shifts = await tx.shift.findMany({
      where: {
        propertyId,
        employeeId: { in: employeeIds },
        status: 'PUBLISHED',
        shiftDate: { gte: toDbDate(from), lte: toDbDate(to) },
      },
    });
    // Night shifts run past midnight: read punches one day beyond the range.
    const punches = await tx.attendancePunch.findMany({
      where: {
        propertyId,
        employeeId: { in: employeeIds },
        at: {
          gte: fromLocal(addDays(from, -1), '12:00', property.timezone),
          lt: fromLocal(addDays(to, 1), '12:00', property.timezone),
        },
      },
      orderBy: { at: 'asc' },
    });
    const leave = await tx.leaveRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        startDate: { lte: toDbDate(to) },
        endDate: { gte: toDbDate(from) },
      },
    });
    const leaveDays = new Set<string>();
    for (const l of leave) {
      for (let d = fromDbDate(l.startDate); d <= fromDbDate(l.endDate); d = addDays(d, 1)) {
        leaveDays.add(`${l.employeeId}:${d}`);
      }
    }
    return computeAttendanceDays({
      timeZone: property.timezone,
      now: new Date(),
      employees: employees.map((e) => ({ id: e.id, name: employeeName(e) })),
      shifts: shifts.map((s) => ({
        employeeId: s.employeeId,
        date: fromDbDate(s.shiftDate),
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        breakMinutes: s.breakMinutes,
      })),
      punches: punches.map((p) => ({ employeeId: p.employeeId, type: p.type, at: p.at })),
      leaveDays,
      from,
      to,
    });
  }

  // ---- Corrections -------------------------------------------------------------------------

  async requestCorrection(input: CorrectionRequest): Promise<AttendanceCorrection> {
    if (!this.access.has('attendance.punch.own', input.propertyId)) {
      throw Problems.forbidden('Missing permission attendance.punch.own for that property');
    }
    const at = new Date(input.at);
    if (at.getTime() > Date.now()) {
      throw Problems.validation([{ path: 'at', message: 'Cannot be in the future' }]);
    }
    return this.db.run(async (tx) => {
      const me = await this.access.myEmployee(tx);
      const property = await this.access.property(tx, input.propertyId);
      const assigned = await tx.employmentAssignment.count({
        where: { employeeId: me.id, propertyId: input.propertyId },
      });
      if (!assigned) {
        throw Problems.validation([
          { path: 'propertyId', message: 'You do not work at this property' },
        ]);
      }
      if (Date.now() - at.getTime() > 62 * 86_400_000) {
        throw Problems.validation([{ path: 'at', message: 'At most 62 days back' }]);
      }
      const row = await tx.attendanceCorrection.create({
        data: {
          organizationId: this.access.organizationId,
          propertyId: property.id,
          employeeId: me.id,
          type: input.type,
          at,
          reason: input.reason,
          requestedBy: this.access.actorId,
        },
        include: correctionInclude,
      });
      await this.audit.record(tx, {
        action: 'attendance.correction_requested',
        entityType: 'attendance_correction',
        entityId: row.id,
        propertyId: property.id,
        after: { type: input.type, at: input.at },
      });
      return toCorrectionDto(row);
    });
  }

  async myCorrections(): Promise<AttendanceCorrection[]> {
    return this.db.run(async (tx) => {
      const me = await this.access.myEmployee(tx);
      const rows = await tx.attendanceCorrection.findMany({
        where: { employeeId: me.id },
        include: correctionInclude,
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return rows.map(toCorrectionDto);
    });
  }

  async corrections(propertyId: string, status?: AttendanceCorrection['status']) {
    const rows = await this.db.run((tx) =>
      tx.attendanceCorrection.findMany({
        where: { propertyId, ...(status ? { status } : {}) },
        include: correctionInclude,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
    return rows.map(toCorrectionDto);
  }

  /** Approving adds an effective punch; the original punches are never changed. */
  async decideCorrection(
    propertyId: string,
    id: string,
    expectedVersion: number,
    input: DecisionRequest,
  ): Promise<AttendanceCorrection> {
    return this.db.run(async (tx) => {
      const current = await tx.attendanceCorrection.findFirst({ where: { id, propertyId } });
      if (!current) throw Problems.notFound('Correction');
      const me = await this.access.findMyEmployee(tx);
      if (me?.id === current.employeeId) {
        throw Problems.forbidden('You cannot decide your own correction.');
      }
      if (current.status !== 'PENDING') throw invalidState('The correction was already decided.');
      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const { count } = await tx.attendanceCorrection.updateMany({
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
      if (status === 'APPROVED') {
        await tx.attendancePunch.create({
          data: {
            organizationId: this.access.organizationId,
            propertyId,
            employeeId: current.employeeId,
            type: current.type,
            at: current.at,
            source: 'CORRECTION',
            correctionId: id,
            recordedBy: this.access.actorId,
          },
        });
      }
      await this.audit.record(tx, {
        action: `attendance.correction_${status.toLowerCase()}`,
        entityType: 'attendance_correction',
        entityId: id,
        propertyId,
        after: { status, note: input.note },
      });
      const row = await tx.attendanceCorrection.findUniqueOrThrow({
        where: { id },
        include: correctionInclude,
      });
      return toCorrectionDto(row);
    });
  }
}
