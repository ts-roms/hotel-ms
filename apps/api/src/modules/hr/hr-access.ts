import { Injectable } from '@nestjs/common';
import {
  type Assignment,
  type EmployeeSummary,
  PERMISSIONS,
  type PermissionCode,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate, toDbDate } from '../../common/dates.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { localToday } from '../../common/zoned-time.js';

export const assignmentInclude = {
  property: { select: { name: true, timezone: true } },
  department: { select: { name: true } },
  position: { select: { name: true } },
} satisfies Prisma.EmploymentAssignmentInclude;

type AssignmentRow = Prisma.EmploymentAssignmentGetPayload<{ include: typeof assignmentInclude }>;

export function toAssignmentDto(a: AssignmentRow): Assignment {
  return {
    id: a.id,
    propertyId: a.propertyId,
    propertyName: a.property.name,
    departmentId: a.departmentId,
    departmentName: a.department.name,
    positionId: a.positionId,
    positionName: a.position?.name ?? null,
    startDate: fromDbDate(a.startDate),
    endDate: a.endDate ? fromDbDate(a.endDate) : null,
    isPrimary: a.isPrimary,
  };
}

/** Assignment in force on a date (inclusive end). */
export const activeOn = (date: string): Prisma.EmploymentAssignmentWhereInput => ({
  startDate: { lte: toDbDate(date) },
  OR: [{ endDate: null }, { endDate: { gte: toDbDate(date) } }],
});

export const employeeName = (e: {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
}) => `${e.preferredName || e.firstName} ${e.lastName}`;

/** In force today in its own property's time zone. */
export function isCurrent(a: AssignmentRow, now = new Date()): boolean {
  const today = localToday(a.property.timezone, now);
  return fromDbDate(a.startDate) <= today && (!a.endDate || fromDbDate(a.endDate) >= today);
}

export function toEmployeeSummary(
  e: Prisma.EmployeeGetPayload<{ include: { assignments: { include: typeof assignmentInclude } } }>,
): EmployeeSummary {
  return {
    id: e.id,
    employeeNo: e.employeeNo,
    firstName: e.firstName,
    lastName: e.lastName,
    preferredName: e.preferredName,
    status: e.status,
    assignments: e.assignments.filter((a) => isCurrent(a)).map(toAssignmentDto),
  };
}

export const notAnEmployee = () =>
  new ProblemException(
    403,
    'NOT_AN_EMPLOYEE',
    'No employee record',
    'Your account is not linked to an employee record. Ask HR to link it.',
  );

/**
 * Employee-level scope checks (blueprint §8, §13.1). Employees are organization records;
 * a property-scoped grant covers the employees with an assignment at that property.
 */
@Injectable()
export class HrAccess {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  get organizationId(): string {
    return this.cls.get('organizationId')!;
  }

  get actorId(): string | null {
    return this.cls.get('identityId') ?? null;
  }

  private get grants() {
    return this.cls.get('grants')!;
  }

  /**
   * Sensitive permissions checked here (not by PermissionGuard, e.g. personal details on an
   * employee route) also need an MFA-verified session, like everywhere else (ADR-0006).
   */
  private usable(permission: PermissionCode): boolean {
    const definition = PERMISSIONS[permission];
    return (
      !('sensitive' in definition && definition.sensitive) || this.cls.get('mfaVerified') === true
    );
  }

  has(permission: PermissionCode, propertyId: string): boolean {
    return this.usable(permission) && this.grants.hasForProperty(permission, propertyId);
  }

  hasAtOrganization(permission: PermissionCode): boolean {
    return this.usable(permission) && this.grants.hasAtOrganization(permission);
  }

  /** WHERE clause limiting employees to those the permission covers. */
  employeeWhere(permission: PermissionCode): Prisma.EmployeeWhereInput {
    const scope = this.grants.propertyScope(permission);
    if (scope.kind === 'all') return {};
    return { assignments: { some: { propertyId: { in: scope.propertyIds } } } };
  }

  /** Does the permission cover this employee (org scope, or any of their properties)? */
  async coversEmployee(tx: Tx, permission: PermissionCode, employeeId: string): Promise<boolean> {
    if (!this.usable(permission)) return false;
    if (this.grants.hasAtOrganization(permission)) return true;
    const scope = this.grants.propertyScope(permission);
    if (scope.kind === 'all') return true;
    if (scope.propertyIds.length === 0) return false;
    const count = await tx.employmentAssignment.count({
      where: { employeeId, propertyId: { in: scope.propertyIds } },
    });
    return count > 0;
  }

  /** 404 for employees outside the caller's scope, as for other tenants' records. */
  async requireEmployee(tx: Tx, permission: PermissionCode, employeeId: string) {
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee || !(await this.coversEmployee(tx, permission, employeeId))) {
      throw Problems.notFound('Employee');
    }
    return employee;
  }

  /** The caller's own active employee record, if their login is linked to one. */
  async findMyEmployee(tx: Tx) {
    const membershipId = this.cls.get('membershipId');
    if (!membershipId) return null;
    const employee = await tx.employee.findUnique({
      where: { organizationId_membershipId: { organizationId: this.organizationId, membershipId } },
      include: { assignments: { include: assignmentInclude, orderBy: { startDate: 'asc' } } },
    });
    return employee?.status === 'ACTIVE' ? employee : null;
  }

  /** The caller's own employee record (self-service); 403 if there is none. */
  async myEmployee(tx: Tx) {
    const employee = await this.findMyEmployee(tx);
    if (!employee) throw notAnEmployee();
    return employee;
  }

  async property(tx: Tx, propertyId: string) {
    const property = await tx.property.findUnique({
      where: { id: propertyId },
      select: { id: true, name: true, timezone: true },
    });
    if (!property) throw Problems.notFound('Property');
    return { ...property, today: localToday(property.timezone) };
  }
}
