import type { Grant, PermissionCode } from '@hotel/contracts';

interface PermissionScopes {
  organization: boolean;
  properties: Set<string>;
}

export type PropertyScope = { kind: 'all' } | { kind: 'some'; propertyIds: string[] };

/**
 * A member's effective permissions within one organization (ADR-0004).
 *
 * ORGANIZATION scope covers every property in the organization; PROPERTY scope covers
 * exactly that property. Pure and immutable: safe to cache and to unit test.
 */
export class GrantSet {
  private readonly byPermission: ReadonlyMap<string, PermissionScopes>;

  constructor(grants: readonly Grant[]) {
    const map = new Map<string, PermissionScopes>();
    for (const grant of grants) {
      let entry = map.get(grant.permission);
      if (!entry) {
        entry = { organization: false, properties: new Set() };
        map.set(grant.permission, entry);
      }
      if (grant.scopeType === 'ORGANIZATION') entry.organization = true;
      else if (grant.propertyId) entry.properties.add(grant.propertyId);
    }
    this.byPermission = map;
  }

  /** Permission held at organization scope (required for org-wide actions). */
  hasAtOrganization(code: PermissionCode): boolean {
    return this.byPermission.get(code)?.organization ?? false;
  }

  /** Permission covers this specific property. */
  hasForProperty(code: PermissionCode, propertyId: string): boolean {
    const entry = this.byPermission.get(code);
    return !!entry && (entry.organization || entry.properties.has(propertyId));
  }

  /** Permission held at any scope. Use only with a scope-filtered query afterwards. */
  hasAnywhere(code: PermissionCode): boolean {
    const entry = this.byPermission.get(code);
    return !!entry && (entry.organization || entry.properties.size > 0);
  }

  /**
   * Which properties a list query may return for this permission. List endpoints must
   * turn this into a WHERE clause; never fetch-then-filter.
   */
  propertyScope(code: PermissionCode): PropertyScope {
    const entry = this.byPermission.get(code);
    if (entry?.organization) return { kind: 'all' };
    return { kind: 'some', propertyIds: entry ? [...entry.properties].sort() : [] };
  }

  /**
   * The grants a shared device leaves an operator (ADR-0020): only the device's
   * permissions, only at the device's property, and only where the operator holds them.
   */
  restrictTo(permissions: readonly PermissionCode[], propertyId: string): GrantSet {
    return new GrantSet(
      permissions
        .filter((p) => this.hasForProperty(p, propertyId))
        .map((permission) => ({ permission, scopeType: 'PROPERTY' as const, propertyId })),
    );
  }

  toJSON(): Grant[] {
    const grants: Grant[] = [];
    for (const [permission, entry] of [...this.byPermission].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (entry.organization)
        grants.push({ permission, scopeType: 'ORGANIZATION', propertyId: null });
      for (const propertyId of [...entry.properties].sort()) {
        grants.push({ permission, scopeType: 'PROPERTY', propertyId });
      }
    }
    return grants;
  }
}
