import { Injectable } from '@nestjs/common';
import type { CreateLeaveTypeRequest, LeaveType, UpdateLeaveTypeRequest } from '@hotel/contracts';
import { isUniqueViolation } from '../../../common/db-errors.js';
import { Problems } from '../../../common/problem.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { HrAccess } from '../hr-access.js';

/** Leave amounts travel as days; the database keeps half-days. */
const days = (halfDays: number) => halfDays / 2;

function toTypeDto(t: {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  allowNegative: boolean;
  minNoticeDays: number;
  accrualHalfDaysPerMonth: number;
  hrApprovalRequired: boolean;
  archivedAt: Date | null;
}): LeaveType {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    paid: t.paid,
    allowNegative: t.allowNegative,
    minNoticeDays: t.minNoticeDays,
    accrualDaysPerMonth: days(t.accrualHalfDaysPerMonth),
    hrApprovalRequired: t.hrApprovalRequired,
    archived: t.archivedAt !== null,
  };
}

/** The organization's leave types (blueprint §13.4): paid or not, accrual, notice, approvals. */
@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: HrAccess,
    private readonly audit: AuditService,
  ) {}

  async types(): Promise<LeaveType[]> {
    const rows = await this.db.run((tx) =>
      tx.leaveType.findMany({ orderBy: [{ archivedAt: 'desc' }, { name: 'asc' }] }),
    );
    return rows.map(toTypeDto);
  }

  async createType(input: CreateLeaveTypeRequest): Promise<LeaveType> {
    try {
      return await this.db.run(async (tx) => {
        const { accrualDaysPerMonth, ...fields } = input;
        const row = await tx.leaveType.create({
          data: {
            organizationId: this.access.organizationId,
            ...fields,
            accrualHalfDaysPerMonth: Math.round(accrualDaysPerMonth * 2),
          },
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
      const { archived, accrualDaysPerMonth, ...fields } = input;
      const row = await tx.leaveType.update({
        where: { id },
        data: {
          ...fields,
          ...(accrualDaysPerMonth !== undefined
            ? { accrualHalfDaysPerMonth: Math.round(accrualDaysPerMonth * 2) }
            : {}),
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
}
