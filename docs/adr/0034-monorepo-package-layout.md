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

| Package             | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@hotel/contracts`  | Zod schemas and their types (`XRequest` parsed, `XRequestInput` as sent; ADR-0009), enums, permission catalog, role templates, feature flag catalog, error codes, event and job types. Shared helpers in `common.ts` (`cursorPage`, `listOf`, `staffRefSchema`). Every app depends on it. Compiled without Node types, since the browser apps share it.                                                                                                                             |
| `@hotel/database`   | Prisma schema (one file per context), migrations incl. RLS, generated client, seed, platform catalog sync, organization provisioning and password hashing. `src/bootstrap` is the db-bootstrap task that creates the database roles in cloud environments; `src/ops` holds operator scripts (local reset, organization provisioning, platform operators). `@hotel/database/testing` is the test harness (test database URLs, reset, demo world); never imported by production code. |
| `@hotel/api-client` | Typed HTTP clients for the staff, guest and kiosk apps; request functions generated from the OpenAPI document. `@hotel/api-client/react` adds the TanStack Query helpers.                                                                                                                                                                                                                                                                                                           |
| `@hotel/ui`         | shadcn-style components and blocks, plus the design tokens in `@hotel/ui/theme.css`.                                                                                                                                                                                                                                                                                                                                                                                                |
| `@hotel/format`     | Money, date, time zone and relative-time formatting, and `escapeHtml`. Used by every app: the web apps for display, the API for its date and currency arithmetic (`addDays`, `localToday`, `toLocal`, `currencyDigits`) and email money, the worker for email templates.                                                                                                                                                                                                            |

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

**Reads and writes across contexts.** A context may read another context's rows inside the
caller's tenant transaction, where the use case needs them (e.g. the guest inbox checks a
reservation line, notifications read the stay they write about). RLS and the property
permission checks apply as to any read. Writes go only through the owning context's services
(`...InTx(tx, ...)` methods, ADR-0031), apart from the exceptions listed there. The management
dashboards and reports, the unified calendar and the finance reports are read models built
this way: read-only projections over data owned by other contexts (stays, folios, shifts,
leave, orders). This narrows blueprint §6.2 ("never direct table access") to what the code
does.

**The API client's HTTP layer is generated from the OpenAPI document; its public shape is
not** (amended 2026-09-29). `pnpm --filter @hotel/api-client generate` runs
`packages/api-client/scripts/generate.mjs`, a small dependency-free script over
`docs/api/openapi.json`, which writes `src/generated/operations.ts`: one typed request
function per operationId (`<Controller>_<method>`) carrying the method, path, path and query
parameters, the `If-Match`/`Idempotency-Key` headers and whether a body (JSON or a raw `Blob`)
is sent, plus a URL builder per operation for same-origin links. Thin facades map those
functions onto the methods the apps call (`api.pms(id).rooms()`, `api.auth.login(...)`,
`createGuestApiClient`, ...) and give them their `@hotel/contracts` request and response
types (query types too, e.g. `ReservationListQuery`; `Page<T>` is the contracts
`CursorPage<T>`). Staff facades follow the API modules (ADR-0031), organization-level ones in
`staff/` and property ones in `staff/property/`, one file per context (`tenancy.ts`,
`access.ts`, `workforce.ts`, `time.ts`, `guest-portal.ts`, `management.ts`, ...), matched by
the operationId's controller; the `hr` and `me` groups span contexts and are merged in
`staff/index.ts`. `guest.ts` and `kiosk.ts` are the guest portal's and shared devices'
clients. The transport (`http.ts`: CSRF header, same-origin credentials, 204, ETag, RFC 9457
problems as `ApiError`) stays hand-written. A renamed, removed or re-parameterized route
therefore breaks the client's type check instead of drifting. The two route families the
client addresses by a kind segment (CSV import preview/commit, report CSV exports) are
checked at type level against the generated route table (`RouteSegment` in `http.ts`).

We chose the in-repo script over orval, openapi-typescript + openapi-fetch and
@hey-api/openapi-ts: the document's schemas are all inline (no `components`), so their
generated types would duplicate `@hotel/contracts`, which the API's schemas come from anyway;
their runtimes would replace the transport's exact request behaviour; and the document omits
some parameters the API reads (`propertyId` declared at controller level, `If-Match` read
with `@Headers`). The script takes path parameters from the path template and lists the other
omissions in `UNDECLARED`; it fails once the document declares one of them, so the list only
shrinks as `@ApiHeader`/`@ApiBody` are added in the API.

The generated file is checked in (ignored by lint and Prettier like other `generated/`
directories). `generate` is also a Turborepo task, so builds regenerate it, and CI regenerates
it after regenerating the OpenAPI document and fails on any diff.

**No `config` or `testing` packages.** Shared TypeScript settings are in the root
`tsconfig.base.json`, lint rules in the root `eslint.config.js` and context dependency rules
in `.dependency-cruiser.cjs`. Test fixtures are `@hotel/database/testing`; end-to-end tests
are in `tests/e2e`.

**Build.** Every package builds with `tsc -p tsconfig.build.json`, which excludes tests;
`tsconfig.json` is used for type checking and the editor.

**The layout is linted** (`pnpm lint`). `.dependency-cruiser.cjs` cruises every app and package:
the worker never imports `apps/api`; `@hotel/contracts`, `@hotel/format` and `@hotel/i18n`
are leaves that import no other workspace package; `@hotel/ui` imports neither
`@hotel/api-client`, `@hotel/contracts` nor `@hotel/database`; apps use a package by its name,
never by a relative path into its `src/` or `dist/`; packages never import an app. ESLint keeps
`@hotel/database` out of both browser apps and `@hotel/database/testing` out of the API's and
the worker's production code.

## Kept as it is

`ROLE_TEMPLATES` (`contracts/src/role-templates.ts`) is only used by `@hotel/database`
(catalog sync, provisioning, seed) and the contracts tests. It stays in contracts next to
the permission catalog it references, so the templates and permission codes are checked
together.

## Consequences

- Blueprint §6.3 now shows this layout and links here.
- A cross-context write goes through the owning context's exported service (ADR-0031); a
  read in the caller's transaction does not need one.
- Adding a shared domain package needs a new ADR.
- Changing an API route changes `docs/api/openapi.json`, then `src/generated/operations.ts`;
  commit both, and fix the facade if its type check fails.
