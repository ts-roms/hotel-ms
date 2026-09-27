# Hotel Platform

A multi-tenant cloud hotel management platform (PMS, guest experience, F&B, HR, finance) built
as a modular monolith. Start with the
[Production System Blueprint](docs/architecture/00-production-system-blueprint.md) and the
[decision records](docs/adr/).

**Status: Phase 0 (walking skeleton).** Tenancy, identity, property-scoped RBAC, audit log,
transactional outbox and the tenant-isolation test suites are in place. Hotel features start
in Phase 2.

## Layout

```
apps/
  api/        NestJS 12 + Fastify REST API (/api/v1, OpenAPI at /api/docs in dev)
  worker/     Outbox relay + BullMQ event consumers
  web/        Next.js 16 staff portal (proxies /api/v1 to the API)
packages/
  contracts/  Zod schemas, permission catalog, error codes, event types (shared by all)
  database/   Prisma schema (one file per bounded context), migrations incl. RLS, seed
  api-client/ Typed client for the web app
  ui/         Shared shadcn-style components
docs/         Architecture blueprint, ADRs, database conventions, generated OpenAPI
infrastructure/docker/  Local Postgres roles, multi-target Dockerfile
```

## Local development

Requires Node 22.12+, pnpm 11 and Docker.

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
pnpm db:up
```

```bash
pnpm build
```

```bash
pnpm db:migrate && pnpm db:seed
```

Then run the API, worker and web app (each in its own terminal):

```bash
pnpm --filter @hotel/api dev
```

```bash
pnpm --filter @hotel/worker dev
```

```bash
pnpm --filter @hotel/web dev
```

Open http://localhost:43100. The seed creates two organizations and several users that cover
the access-scope cases (org admin, single-property GM, multi-property user, org-wide auditor,
multi-organization consultant). They are listed in `packages/database/src/demo-world.ts`,
together with the shared development password. Demo data is never seeded when
`NODE_ENV=production`.

Local ports: Postgres 55432, cache Redis 56379, queue Redis 56380, API 48100, web 43100.

## Checks

| Command                 | What it runs                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm lint`             | ESLint, including tenant-safety rules (no raw Prisma clients or unsafe SQL in apps)                       |
| `pnpm typecheck`        | TypeScript across all packages                                                                            |
| `pnpm test`             | Unit tests                                                                                                |
| `pnpm test:integration` | Real Postgres/Redis: RLS suite, API isolation route matrix, outbox relay. Uses the `hotel_test` database. |
| `pnpm format:check`     | Prettier                                                                                                  |

CI (`.github/workflows/ci.yml`) runs all of these, plus a schema-drift check, a stale-OpenAPI
check, `pnpm audit` and container image builds.

## Rules that are easy to break

- Tenant data is only reached through `TenantDb` (API) or `withDbContext` (worker, seed).
  See [ADR-0003](docs/adr/0003-tenant-isolation.md).
- Every tenant route declares `@RequirePermission(...)`. Routes without one are denied.
- New tables follow [database conventions](docs/database/conventions.md), including the RLS
  migration. The integration suite fails otherwise.
- Changes to data are audited and emit events **inside the same transaction**
  ([ADR-0005](docs/adr/0005-audit-and-outbox.md)).
