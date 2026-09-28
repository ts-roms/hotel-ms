import type { PermissionCode } from './permissions.js';

/**
 * System role templates. Organizations get a copy of each template on creation and may
 * edit their copies. When a template gains permissions in a release, the catalog sync adds
 * them to organization roles still linked to that template (additive only; see
 * packages/database/src/catalog.ts).
 */
export interface RoleTemplate {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly PermissionCode[];
}

/** Permission groups overlap; templates list each permission once. */
const uniq = (...groups: (readonly PermissionCode[])[]): PermissionCode[] => [
  ...new Set(groups.flat()),
];

const PMS_READ = [
  'room.read',
  'rate.read',
  'guest.read',
  'reservation.read',
] as const satisfies readonly PermissionCode[];

const PMS_OPERATE = [
  ...PMS_READ,
  'guest.update',
  'reservation.create',
  'reservation.update',
  'reservation.cancel',
] as const satisfies readonly PermissionCode[];

const FRONT_OFFICE = [
  'stay.check_in',
  'stay.check_out',
  'folio.read',
  'folio.post',
  'folio.void',
  'payment.create',
  'folio.discount',
  'housekeeping.read',
  'maintenance.read',
  'maintenance.report',
  'lost_found.log',
  'lost_found.manage',
] as const satisfies readonly PermissionCode[];

const HOUSEKEEPING = [
  'room.read',
  'housekeeping.read',
  'housekeeping.update',
  'maintenance.read',
  'maintenance.report',
  'lost_found.log',
] as const satisfies readonly PermissionCode[];

const HOUSEKEEPING_LEAD = [
  ...HOUSEKEEPING,
  'housekeeping.inspect',
  'housekeeping.assign',
  'lost_found.manage',
] as const satisfies readonly PermissionCode[];

const GUEST_SERVICE = [
  'guest_service.read',
  'guest_service.update',
  'guest_portal.invite',
] as const satisfies readonly PermissionCode[];

/** Every employee's own-record access (clock in, own shifts, own leave). */
const SELF_SERVICE = [
  'schedule.read.own',
  'attendance.punch.own',
  'leave.request.own',
  'birthday.read',
] as const satisfies readonly PermissionCode[];

const HR_READ = [
  'employee.read',
  'schedule.read',
  'attendance.read',
  'leave.read',
] as const satisfies readonly PermissionCode[];

const PEOPLE_MANAGE = [
  ...HR_READ,
  'employee.manage',
  'schedule.manage',
  'attendance.manage',
  'leave.approve',
] as const satisfies readonly PermissionCode[];

const HR_ADMIN = [
  ...PEOPLE_MANAGE,
  'employee.personal.read',
  'employee.documents',
  'leave.manage',
  'leave.configure',
  'department.manage',
  'payroll.export',
] as const satisfies readonly PermissionCode[];

const FNB_KITCHEN = [
  'fnb.order.read',
  'fnb.order.update',
  'fnb.menu.availability',
] as const satisfies readonly PermissionCode[];

const FNB_MANAGE = [
  ...FNB_KITCHEN,
  'fnb.order.create',
  'fnb.order.cancel_override',
  'fnb.menu.manage',
  'device.manage',
] as const satisfies readonly PermissionCode[];

const FINANCE = [
  'folio.read',
  'folio.adjust',
  'folio.transfer',
  'payment.create',
  'payment.refund',
  'invoice.issue',
  'finance.report.read',
  'exchange_rate.manage',
  'folio.discount',
] as const satisfies readonly PermissionCode[];

const PMS_CONFIGURE = ['room.manage', 'rate.manage'] as const satisfies readonly PermissionCode[];

const PMS_MANAGE = [
  ...PMS_CONFIGURE,
  ...FRONT_OFFICE,
  ...HOUSEKEEPING_LEAD,
  'folio.adjust',
  'tax.manage',
  'night_audit.run',
  ...GUEST_SERVICE,
  'maintenance.work',
  'maintenance.manage',
] as const satisfies readonly PermissionCode[];

export const ROLE_TEMPLATES = [
  {
    key: 'org_admin',
    name: 'Organization Administrator',
    description: 'Full administrative access to the organization.',
    permissions: uniq(
      [
        'organization.read',
        'organization.update',
        'organization.settings.manage',
        'property.read',
        'property.create',
        'property.update',
        'property.settings.manage',
        'member.read',
        'member.invite',
        'member.update',
        'role.read',
        'role.manage',
        'role.assign',
        'audit.read',
        'feature_flag.manage',
      ],
      PMS_OPERATE,
      PMS_MANAGE,
      HR_ADMIN,
      FNB_MANAGE,
      FINANCE,
      ['cashier.shift'],
      SELF_SERVICE,
    ),
  },
  {
    key: 'general_manager',
    name: 'General Manager',
    description: 'Runs one or more properties.',
    permissions: uniq(
      [
        'organization.read',
        'property.read',
        'property.update',
        'property.settings.manage',
        'member.read',
        'member.invite',
        'member.update',
        'role.read',
        'role.assign',
        'audit.read',
      ],
      PMS_OPERATE,
      PMS_MANAGE,
      PEOPLE_MANAGE,
      FNB_MANAGE,
      FINANCE,
      ['cashier.shift'],
      SELF_SERVICE,
    ),
  },
  {
    key: 'hr_manager',
    name: 'HR Manager',
    description: 'Employees, schedules, attendance and leave for their properties.',
    permissions: uniq(['organization.read', 'property.read'], HR_ADMIN, SELF_SERVICE),
  },
  {
    key: 'front_desk',
    name: 'Front Desk Agent',
    description: 'Reservations, guests and arrivals at the front desk.',
    permissions: uniq(
      ['organization.read', 'property.read'],
      PMS_OPERATE,
      FRONT_OFFICE,
      GUEST_SERVICE,
      ['fnb.order.read', 'fnb.order.create', 'cashier.shift', 'invoice.issue'],
      SELF_SERVICE,
    ),
  },
  {
    key: 'housekeeping_supervisor',
    name: 'Housekeeping Supervisor',
    description: 'Runs the housekeeping board: assigns, inspects and releases rooms.',
    permissions: uniq(
      ['organization.read', 'property.read', 'schedule.read'],
      HOUSEKEEPING_LEAD,
      ['guest_service.read', 'guest_service.update'],
      SELF_SERVICE,
    ),
  },
  {
    key: 'housekeeper',
    name: 'Housekeeper',
    description: 'Cleans assigned rooms. Sees only their own tasks.',
    permissions: uniq(['organization.read', 'property.read'], HOUSEKEEPING, SELF_SERVICE),
  },
  {
    key: 'maintenance_technician',
    name: 'Maintenance Technician',
    description: 'Works on maintenance requests at their properties.',
    permissions: uniq(
      ['organization.read', 'property.read', 'room.read', 'housekeeping.read'],
      ['maintenance.read', 'maintenance.report', 'maintenance.work', 'lost_found.log'],
      SELF_SERVICE,
    ),
  },
  {
    key: 'maintenance_supervisor',
    name: 'Maintenance Supervisor',
    description: 'Runs maintenance: assigns work and takes rooms out of order.',
    permissions: uniq(
      ['organization.read', 'property.read', 'room.read', 'housekeeping.read', 'schedule.read'],
      ['maintenance.read', 'maintenance.report', 'maintenance.work', 'maintenance.manage'],
      ['lost_found.log'],
      SELF_SERVICE,
    ),
  },
  {
    key: 'auditor',
    name: 'Auditor',
    description: 'Read-only access to configuration, operations and the audit log.',
    permissions: uniq(
      [
        'organization.read',
        'property.read',
        'member.read',
        'role.read',
        'audit.read',
        'folio.read',
        'housekeeping.read',
        'guest_service.read',
      ],
      PMS_READ,
      HR_READ,
      ['fnb.order.read', 'finance.report.read'],
    ),
  },
  {
    key: 'finance',
    name: 'Group Finance',
    description: 'Folios, payments, refunds, invoices and financial reports.',
    permissions: uniq(
      ['organization.read', 'property.read', 'reservation.read', 'guest.read'],
      FINANCE,
    ),
  },
  {
    key: 'kitchen',
    name: 'Kitchen',
    description: 'Works the kitchen board: confirms, prepares and marks orders ready.',
    permissions: uniq(['organization.read', 'property.read'], FNB_KITCHEN, SELF_SERVICE),
  },
  {
    key: 'room_service_runner',
    name: 'Room Service Runner',
    description: 'Delivers room-service orders.',
    permissions: uniq(
      ['organization.read', 'property.read', 'fnb.order.read', 'fnb.order.update'],
      SELF_SERVICE,
    ),
  },
  {
    key: 'staff',
    name: 'Staff',
    description: 'Baseline access for any staff member.',
    permissions: uniq(['organization.read', 'property.read'], SELF_SERVICE),
  },
] satisfies readonly RoleTemplate[];
