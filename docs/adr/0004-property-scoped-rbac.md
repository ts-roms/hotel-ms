# ADR-0004: Property-scoped RBAC

- Status: Accepted, 2026-09-27
- Blueprint: §9

## Decision

- Permissions are a code catalog (`packages/contracts/src/permissions.ts`) seeded into
  `permissions`. Each declares the scopes it may be granted at (`ORGANIZATION`, `PROPERTY`).
- Roles are organization-owned copies of platform templates. A **role assignment** grants a
  role to a membership at a scope. A grant at a scope the permission does not support is
  ignored. It is never widened to organization scope.
- Each route declares its permission with `@RequirePermission(code, mode)`:
  - `route` (default): property routes need the grant for that property. Other routes need
    it at organization scope.
  - `organization`: always organization scope (e.g. `property.create`).
  - `any`: held anywhere, and the handler **must** filter by `grants.propertyScope()` in the
    query itself (list endpoints).
- **Deny by default.** A tenant route with no declaration is rejected at runtime, and the
  route-inventory test fails the build.
- Out-of-scope property routes answer `404`, like other tenants' properties, so scoped users
  cannot enumerate properties.
- Effective grants are cached in Redis under
  `t:{org}:grants:{membership}:{grants_version}`. Any role or assignment change must bump
  `organization_memberships.grants_version`.

## Not yet built

Role and assignment management endpoints, including the rule that a grantor cannot grant
beyond their own grants, department scope, and "own records" conditions.
