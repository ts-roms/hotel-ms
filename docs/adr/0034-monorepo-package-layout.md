# ADR-0034: Monorepo package layout as built

- Status: Accepted, 2026-09-29
- Spec: blueprint §6.2 (module rules), §6.3 (monorepo layout)
- Builds on ADR-0009 (API contracts) and ADR-0031 (API bounded-context modules)

## Context

Blueprint §6.3 planned eight shared packages (`domain`, `database`, `contracts`,
`api-client`, `ui`, `i18n`, `config`, `testing`) and a NestJS standalone worker. The code
grew differently. This ADR records the layout that exists, so the blueprint and the code
agree again.

## Decision

**Apps.** `apps/api` (NestJS + Fastify), `apps/worker` (plain Node), `apps/web` (staff
portal) and `apps/guest` (guest PWA).

**Packages.**

| Package             | Contents                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@hotel/contracts`  | Zod schemas and their types, enums, permission catalog, role templates, error codes, event and job types. Shared helpers in `common.ts` (`cursorPage`, `listOf`, `staffRefSchema`). The only package every app depends on.                                                           |
| `@hotel/database`   | Prisma schema (one file per context), migrations incl. RLS, generated client, seed, platform catalog sync, organization provisioning and password hashing. `@hotel/database/testing` is the test harness (test database URLs, reset, demo world); never imported by production code. |
| `@hotel/api-client` | Typed HTTP clients for the staff, guest and kiosk apps. `@hotel/api-client/react` adds the TanStack Query helpers.                                                                                                                                                                   |
| `@hotel/ui`         | shadcn-style components and blocks, plus the design tokens in `@hotel/ui/theme.css`.                                                                                                                                                                                                 |
| `@hotel/format`     | Money, date, time zone and relative-time formatting shared by the apps and the worker.                                                                                                                                                                                               |

`@hotel/i18n` holds the message catalogs: `@hotel/i18n/staff` (the staff app) and `@hotel/i18n/guest`
(the guest portal), with a small typed translator. Formatting stays in `@hotel/format`.

**Contract files follow the API contexts** (ADR-0031): one file per context, e.g.
`tenancy.ts`, `inventory.ts`, `pricing.ts`, `guests.ts`, `reservations.ts`, `operations.ts`,
`finance.ts`, `front-office.ts`, `workforce.ts` and `time.ts` (the two halves of `hr`),
`guest-portal.ts`, `fnb.ts` and `calendar.ts` (hotel events), next to the shared kernel
(`common.ts`, `errors.ts`, `permissions.ts`, `domain-events.ts`, `jobs.ts`). `internal.ts`
holds helpers shared between contract files and is not re-exported; `index.ts` re-exports
everything else, so consumers only ever import `@hotel/contracts`.

**Domain logic stays in the API.** There is no `packages/domain`. Bounded-context modules live
in `apps/api/src/modules/` (ADR-0031). The worker only relays the outbox, delivers email and
SMS, and plans scheduled tenant jobs onto a queue; the API processes those jobs (ADR-0017). It
is a plain Node process (BullMQ, Prisma, pino), not a NestJS application, so it needs no
domain module.

**Password hashing lives in `@hotel/database`** (`password.ts`), not in the API, because the
seed and organization provisioning create identities with passwords and must hash them the
same way the API verifies them. The API imports `hashPassword` and `verifyPassword` from it.

**Read models read other contexts' tables directly.** This is a documented exception to
§6.2 ("never direct table access"). The management dashboards and reports, the unified
calendar and the finance reports are read-only projections over data owned by other
contexts (stays, folios, shifts, leave, orders). They query those tables inside the
caller's tenant transaction, so RLS and property permission checks still apply. Writes
still go only through the owning context's services.

**The API client is hand-written and split per context** (`staff/`, `staff/property/`,
`guest.ts`, `kiosk.ts`) over the contract types, not generated from OpenAPI with orval.
ADR-0009 keeps generation as a later option; the checked-in `docs/api/openapi.json` stays the
contract a generator would use.

**No `config` or `testing` packages.** Shared TypeScript settings are in the root
`tsconfig.base.json`, lint rules in the root `eslint.config.js` and context dependency rules
in `.dependency-cruiser.cjs`. Test fixtures are `@hotel/database/testing`; end-to-end tests
are in `tests/e2e`.

**Build.** Every package builds with `tsc -p tsconfig.build.json`, which excludes tests;
`tsconfig.json` is used for type checking and the editor.

## Kept as it is

`ROLE_TEMPLATES` (`contracts/src/role-templates.ts`) is only used by `@hotel/database`
(catalog sync, provisioning, seed) and the contracts tests. It stays in contracts next to
the permission catalog it references, so the templates and permission codes are checked
together.

## Consequences

- Blueprint §6.3 now shows this layout and links here.
- A cross-context read outside the read models above still goes through the owning
  context's exported service (ADR-0031).
- Moving to a generated client or adding a shared domain package needs a new ADR.
