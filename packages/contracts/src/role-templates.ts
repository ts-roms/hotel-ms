import type { PermissionCode } from './permissions.js';

/**
 * System role templates. Organizations get a copy of each template on creation and may
 * edit their copies. Templates grow as modules land (front desk, housekeeping, HR...).
 */
export interface RoleTemplate {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly PermissionCode[];
}

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
    ],
  },
  {
    key: 'auditor',
    name: 'Auditor',
    description: 'Read-only access to configuration and the audit log.',
    permissions: ['organization.read', 'property.read', 'member.read', 'role.read', 'audit.read'],
  },
  {
    key: 'staff',
    name: 'Staff',
    description: 'Baseline access for any staff member.',
    permissions: ['organization.read', 'property.read'],
  },
] as const satisfies readonly RoleTemplate[];
