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

  // ---- PMS: inventory, rates, guests, reservations -----------------------------------
  'room.read': { description: 'View room types, rooms and room status', scopes: ORG_OR_PROPERTY },
  'room.manage': {
    description: 'Configure buildings, room types and rooms; block rooms out of order',
    scopes: ORG_OR_PROPERTY,
  },
  'rate.read': { description: 'View rate plans and prices', scopes: ORG_OR_PROPERTY },
  'rate.manage': { description: 'Configure rate plans and prices', scopes: ORG_OR_PROPERTY },
  'guest.read': { description: 'View guest profiles', scopes: ORG_OR_PROPERTY },
  'guest.update': { description: 'Create and edit guest profiles', scopes: ORG_OR_PROPERTY },
  'reservation.read': {
    description: 'View reservations and availability',
    scopes: ORG_OR_PROPERTY,
  },
  'reservation.create': { description: 'Create reservations', scopes: ORG_OR_PROPERTY },
  'reservation.update': {
    description: 'Modify reservations and assign rooms',
    scopes: ORG_OR_PROPERTY,
  },
  'reservation.cancel': { description: 'Cancel reservations', scopes: ORG_OR_PROPERTY },

  // ---- PMS: front office, folio, housekeeping, night audit ---------------------------
  'stay.check_in': { description: 'Check guests in', scopes: ORG_OR_PROPERTY },
  'stay.check_out': { description: 'Check guests out', scopes: ORG_OR_PROPERTY },
  'folio.read': { description: 'View guest folios and payments', scopes: ORG_OR_PROPERTY },
  'folio.post': { description: 'Post charges to folios', scopes: ORG_OR_PROPERTY },
  'folio.void': {
    description: 'Void charges posted on the current business date',
    scopes: ORG_OR_PROPERTY,
  },
  'folio.adjust': {
    description: 'Post adjustments to folios (after the business day closed)',
    scopes: ORG_OR_PROPERTY,
    sensitive: true,
  },
  'payment.create': { description: 'Record payments', scopes: ORG_OR_PROPERTY },
  'tax.manage': {
    description: 'Configure taxes',
    scopes: ORG_OR_PROPERTY,
    sensitive: true,
  },
  'housekeeping.read': { description: 'View the housekeeping board', scopes: ORG_OR_PROPERTY },
  'housekeeping.update': {
    description: 'Update cleaning status of assigned rooms',
    scopes: ORG_OR_PROPERTY,
  },
  'housekeeping.inspect': { description: 'Inspect and release rooms', scopes: ORG_OR_PROPERTY },
  'housekeeping.assign': {
    description: 'Create and assign housekeeping tasks for any room',
    scopes: ORG_OR_PROPERTY,
  },
  'night_audit.run': {
    description: 'Close the business day (night audit)',
    scopes: ORG_OR_PROPERTY,
    sensitive: true,
  },

  // ---- Guest experience ------------------------------------------------------------------
  'guest_service.read': { description: 'View guest service requests', scopes: ORG_OR_PROPERTY },
  'guest_service.update': {
    description: 'Acknowledge, assign and complete guest service requests',
    scopes: ORG_OR_PROPERTY,
  },
  'guest_portal.invite': {
    description: 'Send guests their portal link',
    scopes: ORG_OR_PROPERTY,
  },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.hasOwn(PERMISSIONS, value);
}

export function permissionAllowsScope(code: PermissionCode, scope: ScopeType): boolean {
  return (PERMISSIONS[code].scopes as readonly ScopeType[]).includes(scope);
}
