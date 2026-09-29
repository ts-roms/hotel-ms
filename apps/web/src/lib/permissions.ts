import type { SessionInfo } from '@hotel/contracts';

/**
 * Permission checks for showing UI, mirroring the API's GrantSet (ADR-0004): an
 * ORGANIZATION-scoped grant covers every property, a PROPERTY-scoped grant exactly one. The API
 * enforces every rule on its own; these only decide what the UI offers. Pure, so unit tested.
 */
type GrantHolder = Pick<SessionInfo, 'grants'> | null | undefined;

/**
 * Has this permission anywhere in the active organization, at any scope. For "anywhere" checks
 * only (organization pages, whether a nav entry exists at all); under /p/[propertyId] use
 * `hasPropertyPermission` (or `useCan()`), which respects property-scoped grants.
 */
export function hasPermission(info: GrantHolder, permission: string): boolean {
  return !!info?.grants.some((g) => g.permission === permission);
}

/** Has this permission for one property: an organization-wide grant or a grant for that property. */
export function hasPropertyPermission(
  info: GrantHolder,
  permission: string,
  propertyId: string,
): boolean {
  return !!info?.grants.some(
    (g) =>
      g.permission === permission &&
      (g.scopeType === 'ORGANIZATION' ||
        (g.scopeType === 'PROPERTY' && g.propertyId === propertyId)),
  );
}
