import {
  isPermissionCode,
  type PermissionCode,
  permissionAllowsScope,
  type ScopeType,
} from '@hotel/contracts';
import type { GrantSet } from '../../common/grant-set.js';

/**
 * Anti-escalation rules for access administration (ADR-0004). Pure functions over the
 * actor's GrantSet so they are exhaustively unit-testable.
 */

export interface ScopeTarget {
  scopeType: ScopeType;
  propertyId: string | null;
}

function holds(grants: GrantSet, permission: PermissionCode, target: ScopeTarget): boolean {
  return target.scopeType === 'ORGANIZATION'
    ? grants.hasAtOrganization(permission)
    : grants.hasForProperty(permission, target.propertyId!);
}

export type Denial = { ok: false; reason: string } | { ok: true };

/**
 * May the actor grant a role with these permissions at this scope?
 * - they need role.assign covering the scope, and
 * - they must themselves hold every permission the role would confer at that scope.
 *   Permissions that cannot apply at the scope (e.g. property.create at a property) are
 *   ignored, because grant evaluation ignores them too.
 */
export function canGrantRole(
  grants: GrantSet,
  rolePermissions: readonly string[],
  target: ScopeTarget,
): Denial {
  if (!holds(grants, 'role.assign', target)) {
    return { ok: false, reason: 'Missing role.assign for this scope' };
  }
  for (const permission of rolePermissions) {
    if (!isPermissionCode(permission)) continue;
    if (!permissionAllowsScope(permission, target.scopeType)) continue;
    if (!holds(grants, permission, target)) {
      return { ok: false, reason: `Cannot grant ${permission}: you do not hold it at this scope` };
    }
  }
  return { ok: true };
}

/**
 * May the actor act on a member (suspend, change) with `permission`? Only if the actor's
 * grant covers every scope the member holds, so nobody can act on someone with access
 * outside their own reach.
 */
export function coversMember(
  grants: GrantSet,
  permission: PermissionCode,
  memberScopes: readonly ScopeTarget[],
): boolean {
  if (grants.hasAtOrganization(permission)) return true;
  if (memberScopes.length === 0) return false;
  return memberScopes.every(
    (scope) => scope.scopeType === 'PROPERTY' && holds(grants, permission, scope),
  );
}

/**
 * Role definitions are organization-wide, so editing one needs every added permission at
 * organization scope.
 */
export function canDefineRole(grants: GrantSet, permissions: readonly string[]): Denial {
  if (!grants.hasAtOrganization('role.manage')) return { ok: false, reason: 'Missing role.manage' };
  for (const permission of permissions) {
    if (!isPermissionCode(permission) || !grants.hasAtOrganization(permission)) {
      return {
        ok: false,
        reason: `Cannot include ${permission}: you do not hold it organization-wide`,
      };
    }
  }
  return { ok: true };
}
