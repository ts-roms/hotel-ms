import { Injectable } from '@nestjs/common';
import { csvField } from '../../../common/csv.js';
import { addDays, fromDbDate, toDbDate } from '../../../common/dates.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { AttendanceService } from './attendance.service.js';

const HEADER = [
  'employee_no',
  'employee_name',
  'date',
  'status',
  'shift_start',
  'shift_end',
  'first_in',
  'last_out',
  'worked_minutes',
  'break_minutes',
  'late_minutes',
  'undertime_minutes',
  'overtime_minutes',
  'leave_type',
  'leave_paid',
];

/**
 * Payroll export (decision D7: payroll itself stays outside; we export its inputs). One
 * row per employee and day with attendance figures from the published schedule and punches,
 * plus approved leave with its type and whether it is paid.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly db: TenantDb,
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
  ) {}

  async exportCsv(propertyId: string, from: string, to: string): Promise<string> {
    const days = await this.attendance.propertyAttendance(propertyId, from, to);
    return this.db.run(async (tx) => {
      const ids = [...new Set(days.map((d) => d.employeeId))];
      const employees = await tx.employee.findMany({
        where: { id: { in: ids } },
        select: { id: true, employeeNo: true },
      });
      const numbers = new Map(employees.map((e) => [e.id, e.employeeNo]));
      const leave = await tx.leaveRequest.findMany({
        where: {
          employeeId: { in: ids },
          status: 'APPROVED',
          startDate: { lte: toDbDate(to) },
          endDate: { gte: toDbDate(from) },
        },
        include: { leaveType: { select: { code: true, paid: true } } },
      });
      const leaveOn = new Map<string, { code: string; paid: boolean }>();
      for (const l of leave) {
        for (let d = fromDbDate(l.startDate); d <= fromDbDate(l.endDate); d = addDays(d, 1)) {
          leaveOn.set(`${l.employeeId}:${d}`, l.leaveType);
        }
      }
      const rows = [...days]
        .sort(
          (a, b) =>
            (numbers.get(a.employeeId) ?? '').localeCompare(numbers.get(b.employeeId) ?? '') ||
            a.date.localeCompare(b.date),
        )
        .map((d) => {
          const l = leaveOn.get(`${d.employeeId}:${d.date}`);
          return [
            numbers.get(d.employeeId) ?? '',
            d.employeeName,
            d.date,
            d.status,
            d.shift?.startsAt ?? null,
            d.shift?.endsAt ?? null,
            d.firstIn,
            d.lastOut,
            d.workedMinutes,
            d.breakMinutes,
            d.lateMinutes,
            d.undertimeMinutes,
            d.overtimeMinutes,
            l?.code ?? null,
            l ? (l.paid ? 'yes' : 'no') : null,
          ]
            .map(csvField)
            .join(',');
        });
      await this.audit.record(tx, {
        action: 'payroll.exported',
        entityType: 'property',
        entityId: propertyId,
        propertyId,
        after: { from, to, rows: rows.length },
      });
      return [HEADER.join(','), ...rows].join('\r\n') + '\r\n';
    });
  }
}
