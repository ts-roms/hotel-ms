import type { PrismaClient } from '../generated/prisma/client.js';
import { withDbContext } from '../context.js';

export interface DemoHr {
  departments: Record<string, string>;
  positions: Record<string, string>;
  leaveTypes: Record<string, string>;
  /** Employee number → employee id */
  employees: Record<string, string>;
  shiftTemplates: Record<string, string>;
}

const DEPARTMENTS = [
  { code: 'ADM', name: 'Administration', positions: [{ code: 'GM', name: 'General Manager' }] },
  { code: 'HR', name: 'Human Resources', positions: [{ code: 'HRM', name: 'HR Manager' }] },
  {
    code: 'FO',
    name: 'Front Office',
    positions: [
      { code: 'FDA', name: 'Front Desk Agent' },
      { code: 'FOM', name: 'Front Office Manager' },
    ],
  },
  {
    code: 'HK',
    name: 'Housekeeping',
    positions: [
      { code: 'RA', name: 'Room Attendant' },
      { code: 'HKS', name: 'Housekeeping Supervisor' },
    ],
  },
  { code: 'FB', name: 'Food & Beverage', positions: [{ code: 'SVR', name: 'Server' }] },
  { code: 'ENG', name: 'Engineering', positions: [{ code: 'TECH', name: 'Technician' }] },
];

/**
 * Philippine starting pack (configuration, not code; blueprint §13.4): each organization
 * edits these freely.
 */
const LEAVE_TYPES = [
  { code: 'SIL', name: 'Service Incentive Leave', minNoticeDays: 0, openingDays: 5 },
  { code: 'VL', name: 'Vacation Leave', minNoticeDays: 3, openingDays: 10 },
  { code: 'SL', name: 'Sick Leave', minNoticeDays: 0, openingDays: 7 },
];

export interface DemoEmployeeSpec {
  employeeNo: string;
  firstName: string;
  lastName: string;
  /** Login to link, if any. */
  email?: string;
  birthDate: string;
  birthdayVisibility: 'DAY_MONTH' | 'HIDDEN';
  assignments: { property: string; department: string; position: string; primary?: boolean }[];
}

export const DEMO_EMPLOYEES: Record<'abc' | 'xyz', DemoEmployeeSpec[]> = {
  abc: [
    {
      employeeNo: 'E001',
      firstName: 'John',
      lastName: 'Reyes',
      email: 'john.gm@abc.test',
      birthDate: '1980-03-12',
      birthdayVisibility: 'DAY_MONTH',
      assignments: [{ property: 'MNL', department: 'ADM', position: 'GM', primary: true }],
    },
    {
      employeeNo: 'E002',
      firstName: 'Maria',
      lastName: 'Santos',
      email: 'maria.hr@abc.test',
      birthDate: '1985-10-05',
      birthdayVisibility: 'DAY_MONTH',
      assignments: [
        { property: 'MNL', department: 'HR', position: 'HRM', primary: true },
        { property: 'CEB', department: 'HR', position: 'HRM' },
      ],
    },
    {
      employeeNo: 'E003',
      firstName: 'Rey',
      lastName: 'Reception',
      email: 'reception@abc.test',
      birthDate: '1995-10-20',
      birthdayVisibility: 'DAY_MONTH',
      assignments: [{ property: 'MNL', department: 'FO', position: 'FDA', primary: true }],
    },
    {
      employeeNo: 'E004',
      firstName: 'Hana',
      lastName: 'Housekeeper',
      email: 'hk@abc.test',
      birthDate: '1990-07-01',
      birthdayVisibility: 'HIDDEN',
      assignments: [{ property: 'MNL', department: 'HK', position: 'RA', primary: true }],
    },
    {
      employeeNo: 'E005',
      firstName: 'Faye',
      lastName: 'Desk',
      email: 'frontdesk@abc.test',
      birthDate: '1998-12-24',
      birthdayVisibility: 'DAY_MONTH',
      assignments: [{ property: 'CEB', department: 'FO', position: 'FDA', primary: true }],
    },
    {
      employeeNo: 'E006',
      firstName: 'Carlo',
      lastName: 'Cruz',
      birthDate: '1992-10-02',
      birthdayVisibility: 'DAY_MONTH',
      assignments: [{ property: 'MNL', department: 'HK', position: 'RA', primary: true }],
    },
    {
      employeeNo: 'E007',
      firstName: 'Lina',
      lastName: 'Ramos',
      birthDate: '1993-05-17',
      birthdayVisibility: 'DAY_MONTH',
      assignments: [{ property: 'DVO', department: 'FB', position: 'SVR', primary: true }],
    },
  ],
  xyz: [
    {
      employeeNo: 'E001',
      firstName: 'Bea',
      lastName: 'Villanueva',
      birthDate: '1991-10-11',
      birthdayVisibility: 'DAY_MONTH',
      assignments: [{ property: 'BOR', department: 'FO', position: 'FDA', primary: true }],
    },
  ],
};

const START = new Date('2026-01-05T00:00:00Z');

/**
 * Demo HR data for one organization: departments, positions, the leave pack with opening
 * balances, employees (linked to demo logins where given) and MNL-style shift templates.
 * Skips organizations that already have departments.
 */
export async function seedDemoHr(
  prisma: PrismaClient,
  organizationId: string,
  properties: Record<string, string>,
  employees: DemoEmployeeSpec[],
): Promise<DemoHr | null> {
  return withDbContext(prisma, { organizationId, identityId: null }, async (tx) => {
    if ((await tx.department.count()) > 0) return null;
    const hr: DemoHr = {
      departments: {},
      positions: {},
      leaveTypes: {},
      employees: {},
      shiftTemplates: {},
    };
    for (const d of DEPARTMENTS) {
      const department = await tx.department.create({
        data: { organizationId, code: d.code, name: d.name },
      });
      hr.departments[d.code] = department.id;
      for (const p of d.positions) {
        const position = await tx.position.create({
          data: { organizationId, departmentId: department.id, code: p.code, name: p.name },
        });
        hr.positions[p.code] = position.id;
      }
    }
    for (const lt of LEAVE_TYPES) {
      const type = await tx.leaveType.create({
        data: { organizationId, code: lt.code, name: lt.name, minNoticeDays: lt.minNoticeDays },
      });
      hr.leaveTypes[lt.code] = type.id;
    }
    for (const spec of employees) {
      const identity = spec.email
        ? await tx.identity.findUnique({ where: { email: spec.email }, select: { id: true } })
        : null;
      const membership = identity
        ? await tx.organizationMembership.findUnique({
            where: { organizationId_identityId: { organizationId, identityId: identity.id } },
            select: { id: true },
          })
        : null;
      const employee = await tx.employee.create({
        data: {
          organizationId,
          employeeNo: spec.employeeNo,
          firstName: spec.firstName,
          lastName: spec.lastName,
          workEmail: spec.email ?? null,
          birthDate: new Date(`${spec.birthDate}T00:00:00Z`),
          birthdayVisibility: spec.birthdayVisibility,
          hireDate: START,
          membershipId: membership?.id ?? null,
        },
      });
      hr.employees[spec.employeeNo] = employee.id;
      for (const a of spec.assignments) {
        const propertyId = properties[a.property];
        if (!propertyId) continue;
        await tx.employmentAssignment.create({
          data: {
            organizationId,
            employeeId: employee.id,
            propertyId,
            departmentId: hr.departments[a.department]!,
            positionId: hr.positions[a.position]!,
            startDate: START,
            isPrimary: a.primary ?? false,
          },
        });
      }
      for (const lt of LEAVE_TYPES) {
        await tx.leaveLedgerEntry.create({
          data: {
            organizationId,
            employeeId: employee.id,
            leaveTypeId: hr.leaveTypes[lt.code]!,
            kind: 'ACCRUAL',
            halfDays: lt.openingDays * 2,
            effectiveDate: new Date('2026-01-01T00:00:00Z'),
            note: 'Opening balance 2026',
          },
        });
      }
    }
    for (const [propertyCode, propertyId] of Object.entries(properties)) {
      for (const t of [
        { name: 'Morning', startTime: '06:00', endTime: '14:00' },
        { name: 'Afternoon', startTime: '14:00', endTime: '22:00' },
        { name: 'Night', startTime: '22:00', endTime: '06:00' },
      ]) {
        const template = await tx.shiftTemplate.create({
          data: { organizationId, propertyId, ...t, breakMinutes: 60 },
        });
        if (propertyCode === 'MNL' || propertyCode === 'BOR') {
          hr.shiftTemplates[`${propertyCode}:${t.name}`] = template.id;
        }
      }
    }
    return hr;
  });
}
