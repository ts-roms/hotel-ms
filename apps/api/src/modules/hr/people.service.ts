import { Injectable } from '@nestjs/common';
import type {
  Birthday,
  CreateDepartmentRequest,
  CreateEmployeeRequest,
  CreatePositionRequest,
  Department,
  Employee,
  EmployeeListQuery,
  EmployeeSummary,
  NewAssignment,
  UpdateDepartmentRequest,
  UpdateEmployeeRequest,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { fromDbDate, toDbDate } from '../../common/dates.js';
import { isUniqueViolation, withConstraintMapping } from '../../common/db-errors.js';
import { Problems } from '../../common/problem.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import {
  activeOn,
  assignmentInclude,
  employeeName,
  HrAccess,
  toAssignmentDto,
  toEmployeeSummary,
} from './hr-access.js';

const employeeInclude = {
  assignments: { include: assignmentInclude, orderBy: { startDate: 'asc' } },
} satisfies Prisma.EmployeeInclude;

type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

/** The emergency contact's columns; null clears them. */
function emergencyColumns(contact: { name: string; relationship: string; phone: string } | null) {
  return {
    emergencyContactName: contact?.name ?? null,
    emergencyContactRelationship: contact?.relationship || null,
    emergencyContactPhone: contact?.phone ?? null,
  };
}

@Injectable()
export class PeopleService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: HrAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ---- Departments and positions -----------------------------------------------------------

  async departments(): Promise<Department[]> {
    const rows = await this.db.run((tx) =>
      tx.department.findMany({
        include: { positions: { orderBy: { name: 'asc' } } },
        orderBy: { name: 'asc' },
      }),
    );
    return rows.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      archived: d.archivedAt !== null,
      positions: d.positions.map((p) => ({
        id: p.id,
        departmentId: p.departmentId,
        code: p.code,
        name: p.name,
        archived: p.archivedAt !== null,
      })),
    }));
  }

  async createDepartment(input: CreateDepartmentRequest): Promise<Department[]> {
    await this.unique(`A department or position with code ${input.code} already exists.`, () =>
      this.db.run(async (tx) => {
        const row = await tx.department.create({
          data: { organizationId: this.access.organizationId, ...input },
        });
        await this.audit.record(tx, {
          action: 'department.created',
          entityType: 'department',
          entityId: row.id,
          after: input,
        });
      }),
    );
    return this.departments();
  }

  async updateDepartment(id: string, input: UpdateDepartmentRequest): Promise<Department[]> {
    await this.db.run(async (tx) => {
      const current = await tx.department.findUnique({ where: { id } });
      if (!current) throw Problems.notFound('Department');
      await tx.department.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.archived !== undefined
            ? { archivedAt: input.archived ? (current.archivedAt ?? new Date()) : null }
            : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'department.updated',
        entityType: 'department',
        entityId: id,
        before: { name: current.name, archived: current.archivedAt !== null },
        after: input,
      });
    });
    return this.departments();
  }

  async createPosition(input: CreatePositionRequest): Promise<Department[]> {
    await this.unique(`A position with code ${input.code} already exists.`, () =>
      this.db.run(async (tx) => {
        const department = await tx.department.findUnique({ where: { id: input.departmentId } });
        if (!department) {
          throw Problems.validation([{ path: 'departmentId', message: 'Unknown department' }]);
        }
        const row = await tx.position.create({
          data: { organizationId: this.access.organizationId, ...input },
        });
        await this.audit.record(tx, {
          action: 'position.created',
          entityType: 'position',
          entityId: row.id,
          after: input,
        });
      }),
    );
    return this.departments();
  }

  // ---- Employees ---------------------------------------------------------------------------

  async list(query: EmployeeListQuery): Promise<EmployeeSummary[]> {
    const rows = await this.db.run((tx) =>
      tx.employee.findMany({
        where: {
          AND: [
            this.access.employeeWhere('employee.read'),
            query.propertyId ? { assignments: { some: { propertyId: query.propertyId } } } : {},
            query.status ? { status: query.status } : {},
            query.q
              ? {
                  OR: [
                    { firstName: { contains: query.q, mode: 'insensitive' } },
                    { lastName: { contains: query.q, mode: 'insensitive' } },
                    { preferredName: { contains: query.q, mode: 'insensitive' } },
                    { employeeNo: { contains: query.q, mode: 'insensitive' } },
                  ],
                }
              : {},
          ],
        },
        include: employeeInclude,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: query.limit,
      }),
    );
    return rows.map(toEmployeeSummary);
  }

  private async toDto(tx: Tx, e: EmployeeRow): Promise<Employee> {
    const personal = await this.access.coversEmployee(tx, 'employee.personal.read', e.id);
    return {
      ...toEmployeeSummary(e),
      workEmail: e.workEmail,
      workPhone: e.workPhone,
      hireDate: fromDbDate(e.hireDate),
      terminatedOn: e.terminatedOn ? fromDbDate(e.terminatedOn) : null,
      employmentType: e.employmentType as Employee['employmentType'],
      birthdayVisibility: e.birthdayVisibility,
      membershipId: e.membershipId,
      assignmentHistory: e.assignments.map(toAssignmentDto),
      personal: personal
        ? {
            birthDate: e.birthDate ? fromDbDate(e.birthDate) : null,
            personalEmail: e.personalEmail,
            personalPhone: e.personalPhone,
            emergencyContact:
              e.emergencyContactName && e.emergencyContactPhone
                ? {
                    name: e.emergencyContactName,
                    relationship: e.emergencyContactRelationship ?? '',
                    phone: e.emergencyContactPhone,
                  }
                : null,
          }
        : null,
      version: e.version,
    };
  }

  private async load(tx: Tx, id: string): Promise<EmployeeRow> {
    return tx.employee.findUniqueOrThrow({ where: { id }, include: employeeInclude });
  }

  async get(id: string): Promise<Employee> {
    return this.db.run(async (tx) => {
      await this.access.requireEmployee(tx, 'employee.read', id);
      return this.toDto(tx, await this.load(tx, id));
    });
  }

  /** Validates a new assignment against the caller's scope and the org's catalog. */
  private async checkAssignment(tx: Tx, a: NewAssignment): Promise<void> {
    if (!this.access.has('employee.manage', a.propertyId)) {
      throw Problems.forbidden('Missing permission employee.manage for that property');
    }
    if (a.endDate && a.endDate < a.startDate) {
      throw Problems.validation([{ path: 'endDate', message: 'Before the start date' }]);
    }
    const property = await tx.property.count({ where: { id: a.propertyId } });
    const department = await tx.department.findUnique({ where: { id: a.departmentId } });
    const position = a.positionId
      ? await tx.position.findUnique({ where: { id: a.positionId } })
      : null;
    if (!property) throw Problems.validation([{ path: 'propertyId', message: 'Unknown property' }]);
    if (!department || department.archivedAt) {
      throw Problems.validation([{ path: 'departmentId', message: 'Unknown department' }]);
    }
    if (a.positionId && (!position || position.departmentId !== a.departmentId)) {
      throw Problems.validation([
        { path: 'positionId', message: 'Unknown position, or not in that department' },
      ]);
    }
  }

  async create(input: CreateEmployeeRequest): Promise<Employee> {
    if (input.personal && !this.access.has('employee.personal.read', input.assignment.propertyId)) {
      throw Problems.forbidden('Missing permission employee.personal.read');
    }
    return this.unique(`Employee number ${input.employeeNo} is already in use.`, () =>
      withConstraintMapping(() =>
        this.db.run(async (tx) => {
          await this.checkAssignment(tx, input.assignment);
          const { assignment, personal, ...fields } = input;
          const employee = await tx.employee.create({
            data: {
              organizationId: this.access.organizationId,
              ...fields,
              hireDate: toDbDate(input.hireDate),
              ...(personal
                ? {
                    birthDate: personal.birthDate ? toDbDate(personal.birthDate) : null,
                    personalEmail: personal.personalEmail,
                    personalPhone: personal.personalPhone,
                    ...emergencyColumns(personal.emergencyContact),
                  }
                : {}),
              createdBy: this.access.actorId,
            },
          });
          await this.addAssignment(tx, employee.id, assignment);
          await this.audit.record(tx, {
            action: 'employee.created',
            entityType: 'employee',
            entityId: employee.id,
            propertyId: assignment.propertyId,
            after: { employeeNo: employee.employeeNo, propertyId: assignment.propertyId },
          });
          await this.outbox.enqueue(
            tx,
            'EmployeeHired',
            { employeeId: employee.id },
            {
              propertyId: assignment.propertyId,
            },
          );
          return this.toDto(tx, await this.load(tx, employee.id));
        }),
      ),
    );
  }

  private async addAssignment(tx: Tx, employeeId: string, a: NewAssignment): Promise<void> {
    await tx.employmentAssignment.create({
      data: {
        organizationId: this.access.organizationId,
        employeeId,
        propertyId: a.propertyId,
        departmentId: a.departmentId,
        positionId: a.positionId,
        startDate: toDbDate(a.startDate),
        endDate: a.endDate ? toDbDate(a.endDate) : null,
        isPrimary: a.isPrimary,
        createdBy: this.access.actorId,
      },
    });
  }

  async update(
    id: string,
    expectedVersion: number,
    input: UpdateEmployeeRequest,
  ): Promise<Employee> {
    return this.db.run(async (tx) => {
      const current = await this.access.requireEmployee(tx, 'employee.read', id);
      if (!(await this.access.coversEmployee(tx, 'employee.manage', id))) {
        throw Problems.forbidden('Missing permission employee.manage');
      }
      if (input.personal && !(await this.access.coversEmployee(tx, 'employee.personal.read', id))) {
        throw Problems.forbidden('Missing permission employee.personal.read');
      }
      const { personal, ...fields } = input;
      const { count } = await tx.employee.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...fields,
          ...(personal?.birthDate !== undefined
            ? { birthDate: personal.birthDate ? toDbDate(personal.birthDate) : null }
            : {}),
          ...(personal?.personalEmail !== undefined
            ? { personalEmail: personal.personalEmail }
            : {}),
          ...(personal?.personalPhone !== undefined
            ? { personalPhone: personal.personalPhone }
            : {}),
          ...(personal?.emergencyContact !== undefined
            ? emergencyColumns(personal.emergencyContact)
            : {}),
          version: { increment: 1 },
        },
      });
      if (count !== 1) throw Problems.versionConflict();
      await this.audit.record(tx, {
        action: 'employee.updated',
        entityType: 'employee',
        entityId: id,
        // Personal values are not copied into the audit log, only which fields changed.
        before: { version: current.version },
        after: { ...fields, personalFieldsChanged: Object.keys(personal ?? {}) },
      });
      return this.toDto(tx, await this.load(tx, id));
    });
  }

  async addEmployeeAssignment(id: string, input: NewAssignment): Promise<Employee> {
    return withConstraintMapping(() =>
      this.db.run(async (tx) => {
        const employee = await this.access.requireEmployee(tx, 'employee.read', id);
        if (employee.status !== 'ACTIVE') throw Problems.conflict('The employee is terminated.');
        await this.checkAssignment(tx, input);
        await this.addAssignment(tx, id, input);
        await this.audit.record(tx, {
          action: 'employee.assignment_added',
          entityType: 'employee',
          entityId: id,
          propertyId: input.propertyId,
          after: input,
        });
        return this.toDto(tx, await this.load(tx, id));
      }),
    );
  }

  async endAssignment(id: string, assignmentId: string, endDate: string): Promise<Employee> {
    return withConstraintMapping(() =>
      this.db.run(async (tx) => {
        await this.access.requireEmployee(tx, 'employee.read', id);
        const assignment = await tx.employmentAssignment.findFirst({
          where: { id: assignmentId, employeeId: id },
        });
        if (!assignment) throw Problems.notFound('Assignment');
        if (!this.access.has('employee.manage', assignment.propertyId)) {
          throw Problems.forbidden('Missing permission employee.manage for that property');
        }
        if (assignment.endDate && fromDbDate(assignment.endDate) <= endDate) {
          throw Problems.conflict('The assignment already ends by then.');
        }
        await tx.employmentAssignment.update({
          where: { id: assignmentId },
          data: { endDate: toDbDate(endDate), isPrimary: false },
        });
        await this.cancelShiftsAfter(tx, id, endDate, assignment.propertyId);
        await this.audit.record(tx, {
          action: 'employee.assignment_ended',
          entityType: 'employee',
          entityId: id,
          propertyId: assignment.propertyId,
          after: { assignmentId, endDate },
        });
        return this.toDto(tx, await this.load(tx, id));
      }),
    );
  }

  /** Future shifts after the last working day go away with the assignment. */
  private async cancelShiftsAfter(
    tx: Tx,
    employeeId: string,
    lastDay: string,
    propertyId?: string,
  ) {
    await tx.shift.updateMany({
      where: {
        employeeId,
        ...(propertyId ? { propertyId } : {}),
        shiftDate: { gt: toDbDate(lastDay) },
        status: { not: 'CANCELLED' },
      },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });
  }

  async terminate(id: string, terminatedOn: string): Promise<Employee> {
    return this.db.run(async (tx) => {
      const employee = await this.access.requireEmployee(tx, 'employee.read', id);
      if (!(await this.coversAllAssignments(tx, id))) {
        throw Problems.forbidden('Terminating needs employee.manage for all of their properties');
      }
      if (employee.status === 'TERMINATED') throw Problems.conflict('Already terminated.');
      await tx.employee.update({
        where: { id },
        data: {
          status: 'TERMINATED',
          terminatedOn: toDbDate(terminatedOn),
          version: { increment: 1 },
        },
      });
      // Open-ended or later assignments end on the last day; future ones are cut back to it.
      const open = await tx.employmentAssignment.findMany({
        where: {
          employeeId: id,
          OR: [{ endDate: null }, { endDate: { gt: toDbDate(terminatedOn) } }],
        },
      });
      for (const a of open) {
        const end = fromDbDate(a.startDate) > terminatedOn ? fromDbDate(a.startDate) : terminatedOn;
        await tx.employmentAssignment.update({
          where: { id: a.id },
          data: { endDate: toDbDate(end), isPrimary: false },
        });
      }
      await this.cancelShiftsAfter(tx, id, terminatedOn);
      await this.audit.record(tx, {
        action: 'employee.terminated',
        entityType: 'employee',
        entityId: id,
        after: { terminatedOn },
      });
      await this.outbox.enqueue(tx, 'EmployeeTerminated', { employeeId: id, terminatedOn });
      return this.toDto(tx, await this.load(tx, id));
    });
  }

  private async coversAllAssignments(tx: Tx, employeeId: string): Promise<boolean> {
    if (this.access.hasAtOrganization('employee.manage')) return true;
    const properties = await tx.employmentAssignment.findMany({
      where: { employeeId },
      select: { propertyId: true },
      distinct: ['propertyId'],
    });
    return properties.every((p) => this.access.has('employee.manage', p.propertyId));
  }

  /** Links a staff login (membership) to the employee; organization-scope HR only. */
  async linkMembership(id: string, membershipId: string | null): Promise<Employee> {
    if (!this.access.hasAtOrganization('employee.manage')) {
      throw Problems.forbidden('Linking logins needs employee.manage at organization scope');
    }
    return this.unique('That login is already linked to another employee.', () =>
      this.db.run(async (tx) => {
        const employee = await this.access.requireEmployee(tx, 'employee.read', id);
        if (membershipId) {
          const membership = await tx.organizationMembership.findUnique({
            where: { id: membershipId },
          });
          if (!membership) {
            throw Problems.validation([{ path: 'membershipId', message: 'Unknown member' }]);
          }
        }
        await tx.employee.update({
          where: { id },
          data: { membershipId, version: { increment: 1 } },
        });
        await this.audit.record(tx, {
          action: 'employee.login_linked',
          entityType: 'employee',
          entityId: id,
          before: { membershipId: employee.membershipId },
          after: { membershipId },
        });
        return this.toDto(tx, await this.load(tx, id));
      }),
    );
  }

  // ---- Birthdays ---------------------------------------------------------------------------

  /**
   * Colleagues at a property who share their birthday, soonest first. Day and month only:
   * the year never leaves HR records (blueprint §13.5).
   */
  async birthdays(propertyId: string): Promise<Birthday[]> {
    return this.db.run(async (tx) => {
      const property = await this.access.property(tx, propertyId);
      const rows = await tx.employee.findMany({
        where: {
          status: 'ACTIVE',
          birthdayVisibility: 'DAY_MONTH',
          birthDate: { not: null },
          assignments: { some: { propertyId, ...activeOn(property.today) } },
        },
        select: { id: true, firstName: true, lastName: true, preferredName: true, birthDate: true },
      });
      const todayKey = property.today.slice(5);
      return rows
        .map((e) => {
          const md = fromDbDate(e.birthDate!).slice(5);
          return {
            employeeId: e.id,
            name: employeeName(e),
            month: Number(md.slice(0, 2)),
            day: Number(md.slice(3)),
            sortKey: `${md >= todayKey ? 0 : 1}${md}`,
          };
        })
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
        .map(({ sortKey: _, ...b }) => b);
    });
  }

  private async unique<T>(message: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error)) throw Problems.conflict(message);
      throw error;
    }
  }
}
