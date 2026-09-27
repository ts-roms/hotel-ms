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
  `t:{org}:grants:{membership}:{grants_version}:{catalog fingerprint}`. Any role or assignment change must bump
  `organization_memberships.grants_version`.

## Access administration (Phase 1)

Pure functions in `apps/api/src/modules/access/access-policy.ts`, unit-tested:

- **Granting** a role at a scope requires `role.assign` covering that scope, **and** holding
  every permission the role would confer there. Organization-only permissions are ignored
  at property scope, because grant evaluation ignores them too. **Removing** an assignment
  follows the same rule: you may only take away what you could have given.
- **Inviting** also requires `member.invite` covering each target scope, and an
  MFA-verified session, since it grants access.
- **Acting on a member** (suspend or reactivate) requires the actor's grant to cover _every_
  scope the member holds. A property GM cannot suspend someone who also works elsewhere.
- **Defining roles** is organization-wide. Every permission added must be held at
  organization scope.
- **Last administrator.** At least one ACTIVE member must hold `role.manage` at organization
  scope. Access mutations lock the organization row (`SELECT … FOR UPDATE`) and re-check this
  inside the transaction, so concurrent removals cannot race past it.
- Property-scoped viewers see only members holding a role at one of their properties.
- Every change bumps `grants_version` for the affected memberships and is audited.

## Not yet built

Department scope and "own records" conditions. Removing members entirely (status
REMOVED), and a role editor UI (the API supports create, update and delete).
