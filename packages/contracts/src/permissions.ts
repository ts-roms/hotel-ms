/**
 * Permission catalog. This file is the single source of truth: the database `permissions`
 * table is seeded from it, and API handlers reference these codes.
 *
 * Permissions are added when the module that enforces them lands. Do not declare
 * permissions for features that do not exist yet.
 */

export const SCOPE_TYPES = ['ORGANIZATION', 'PROPERTY'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export interface PermissionDefinition {
  readonly description: string;
  /** Scopes at which this permission may be granted. */
  readonly scopes: readonly ScopeType[];
  /** Sensitive permissions require MFA-enabled holders and step-up for use (ADR-0006). */
  readonly sensitive?: boolean;
}

const ORG_ONLY = ['ORGANIZATION'] as const;
const ORG_OR_PROPERTY = ['ORGANIZATION', 'PROPERTY'] as const;

export const PERMISSIONS = {
  'organization.read': { description: 'View organization profile', scopes: ORG_ONLY },
  'organization.update': { description: 'Edit organization profile', scopes: ORG_ONLY },
  'organization.settings.manage': {
    description: 'Manage organization-wide settings',
    scopes: ORG_ONLY,
  },

  'property.read': {
    description: 'View property profile and configuration',
    scopes: ORG_OR_PROPERTY,
  },
  'property.create': { description: 'Create properties in the organization', scopes: ORG_ONLY },
  'property.update': { description: 'Edit property profile', scopes: ORG_OR_PROPERTY },
  'property.settings.manage': {
    description: 'Manage property settings and policies',
    scopes: ORG_OR_PROPERTY,
  },

  'member.read': { description: 'View staff user accounts', scopes: ORG_OR_PROPERTY },
  'member.invite': { description: 'Invite staff users', scopes: ORG_OR_PROPERTY },
  'member.update': { description: 'Edit and suspend staff users', scopes: ORG_OR_PROPERTY },

  'role.read': { description: 'View roles and assignments', scopes: ORG_OR_PROPERTY },
  'role.manage': {
    description: 'Create and edit roles',
    scopes: ORG_ONLY,
    sensitive: true,
  },
  'role.assign': {
    description: 'Assign roles to staff users within scope',
    scopes: ORG_OR_PROPERTY,
    sensitive: true,
  },

  'audit.read': { description: 'View audit log', scopes: ORG_OR_PROPERTY, sensitive: true },
  'feature_flag.manage': { description: 'Enable or disable features', scopes: ORG_ONLY },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.hasOwn(PERMISSIONS, value);
}

export function permissionAllowsScope(code: PermissionCode, scope: ScopeType): boolean {
  return (PERMISSIONS[code].scopes as readonly ScopeType[]).includes(scope);
}
