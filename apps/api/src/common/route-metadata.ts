import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@hotel/contracts';

export const IS_PUBLIC = 'route:public';
export const NO_ORGANIZATION = 'route:no-organization';
export const REQUIRED_PERMISSION = 'route:permission';

/** No session required (login, health). Unsafe methods are still Origin-checked. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Signed in, but no organization context (session info, logout, org switch).
 * Such routes must not touch tenant data.
 */
export const NoOrganization = () => SetMetadata(NO_ORGANIZATION, true);

/**
 * How the permission's scope is checked:
 * - `route`        (default) if the path has :propertyId, the grant must cover that
 *                  property; otherwise it must be held at organization scope.
 * - `organization` always requires organization scope.
 * - `any`          held at any scope; the handler MUST filter by grants.propertyScope().
 */
export type PermissionScopeMode = 'route' | 'organization' | 'any';

export interface PermissionRequirement {
  permission: PermissionCode;
  mode: PermissionScopeMode;
}

/**
 * Every tenant route must declare one. Routes without it are denied (deny by default),
 * and the route inventory test fails the build.
 */
export const RequirePermission = (
  permission: PermissionCode,
  mode: PermissionScopeMode = 'route',
) => SetMetadata(REQUIRED_PERMISSION, { permission, mode } satisfies PermissionRequirement);
