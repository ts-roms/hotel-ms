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

const PMS_CONFIGURE = ['room.manage', 'rate.manage'] as const satisfies readonly PermissionCode[];

export const ROLE_TEMPLATES = [
  {
    key: 'org_admin',
    name: 'Organization Administrator',
    description: 'Full administrative access to the organization.',
    permissions: [
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
      ...PMS_OPERATE,
      ...PMS_CONFIGURE,
    ],
  },
  {
    key: 'general_manager',
    name: 'General Manager',
    description: 'Runs one or more properties.',
    permissions: [
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
      ...PMS_OPERATE,
      ...PMS_CONFIGURE,
    ],
  },
  {
    key: 'front_desk',
    name: 'Front Desk Agent',
    description: 'Reservations, guests and arrivals at the front desk.',
    permissions: ['organization.read', 'property.read', ...PMS_OPERATE],
  },
  {
    key: 'auditor',
    name: 'Auditor',
    description: 'Read-only access to configuration, operations and the audit log.',
    permissions: [
      'organization.read',
      'property.read',
      'member.read',
      'role.read',
      'audit.read',
      ...PMS_READ,
    ],
  },
  {
    key: 'staff',
    name: 'Staff',
    description: 'Baseline access for any staff member.',
    permissions: ['organization.read', 'property.read'],
  },
] as const satisfies readonly RoleTemplate[];
