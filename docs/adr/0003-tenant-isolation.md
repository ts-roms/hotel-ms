# ADR-0003: Tenant isolation: shared schema, RLS, composite foreign keys

- Status: Accepted, 2026-09-27
- Blueprint: §2, §7.3, §8

## Decision

Shared database and shared schema. Every tenant-owned row carries `organization_id`.
Isolation is enforced in three independent layers.

1. **Application.** The organization comes only from the server-side session
   (`sessions.active_organization_id`, set at login or org switch after verifying membership).
   `TenantGuard` re-verifies an ACTIVE membership on every request. A `:propertyId` route
   parameter is accepted only if that property exists **within** the organization. Otherwise
   the response is `404`, the same as for a missing property.
2. **PostgreSQL RLS** (`20260927093000_tenant_isolation`). Each tenant table has RLS
   `ENABLE` + `FORCE` and a `tenant_isolation` policy on
   `organization_id = app.current_org_id()`. The setting is applied with `SET LOCAL`
   semantics (`set_config(..., true)`) inside each transaction by `withDbContext()`. With no
   context, `app.current_org_id()` is `NULL`, so the policy matches nothing (fail closed).
3. **Composite FKs.** Parents expose `UNIQUE (organization_id, id)`. Children reference
   `(organization_id, parent_id)`, so a row cannot point at another tenant's parent even if
   the application sets `organization_id` itself.

### Database roles

| Role                          | Used by                       | RLS                                                                                       |
| ----------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| owner (`hotel_owner`)         | migrations, catalog sync      | Owns tables. Subject to FORCE RLS for tenant rows.                                        |
| `app_rw` (`hotel_app`)        | API, seed, worker tenant work | Enforced. No BYPASSRLS. No UPDATE/DELETE on append-only tables.                           |
| `app_system` (`hotel_system`) | outbox relay                  | Sees `outbox_events` only, through an explicit policy. Permission denied everywhere else. |

`app_system` deliberately has **no BYPASSRLS**. Managed Postgres services often cannot grant
it, and an explicit per-table policy is narrower.

### Guardrails

- `packages/database/test/rls.integration.test.ts` fails if any table with an
  `organization_id` column lacks enabled + forced RLS and a `tenant_isolation` policy.
- `apps/api/test/isolation.integration.test.ts` builds its route matrix from the
  controllers. Every tenant route is exercised by foreign principals.
- ESLint forbids creating Prisma clients or using `$queryRawUnsafe` in application code.
- `CacheRedis.tenantKey()` makes the organization part of every tenant cache key.

## Consequences

- Every tenant query is a (short) transaction. That is acceptable at this scale and
  compatible with PgBouncer transaction pooling.
- Property scope is enforced by the application (permission layer), not by RLS, because
  group users legitimately query across properties.
- Moving a tenant to its own database or cell later is a data copy filtered by
  `organization_id`.
