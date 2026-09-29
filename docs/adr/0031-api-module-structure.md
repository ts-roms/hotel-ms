# ADR-0031: API bounded-context modules

- Status: Accepted, 2026-09-29
- Spec: blueprint §6.1 (bounded contexts), §6.2 (module rules)
- Builds on ADR-0009 (API contracts); replaces the single Phase 0 Nest module

## Decision

**One folder and one Nest module per bounded context** under `apps/api/src/modules/`. Each
`<context>.module.ts` declares its controllers and providers, imports the context modules it
calls, and exports only the services other contexts inject. `AppModule` imports the context
modules and keeps the global exception filter and guards, in their required order.

**Shared kernel.** `CoreModule` (`apps/api/src/core.module.ts`) is global and provides
configuration (`ENV`), Prisma and `TenantDb`, Redis and the rate limiter, the notification
queue, realtime, the secret box, object storage and idempotency. `AuditModule` and
`OutboxModule` are global too, since every context writes audit entries and events. Context
modules never re-provide these.

**One controller class per file**, named after the class.

**Module map.**

| Folder           | Context (blueprint §6.1)                 | Contents                                                                                                                                                               |
| ---------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit/`         | Shared kernel (global)                   | audit log service and `/audit-logs`                                                                                                                                    |
| `outbox/`        | Shared kernel (global)                   | outbox writer                                                                                                                                                          |
| `health/`        | Platform                                 | liveness and readiness probes                                                                                                                                          |
| `ops/`           | Platform operators (ADR-0029)            | queue and outbox overview and retries                                                                                                                                  |
| `access/`        | Access                                   | memberships, roles, role assignments, grants, invitations                                                                                                              |
| `auth/`          | Platform                                 | sessions, login, MFA, passwords, kiosk device sign-in, the global guards                                                                                               |
| `tenancy/`       | Tenancy                                  | organization settings and feature flags, properties                                                                                                                    |
| `notifications/` | Messaging                                | staff notification center, guest messages, guest inbox                                                                                                                 |
| `pms/`           | Inventory, Pricing, Reservations, Guests | `inventory/` (rooms, buildings, blocks), `pricing/` (rate plans, quotes, tax engine, tax rules), `reservations/`, `guests/` (profiles and guest ID documents)          |
| `operations/`    | Operations                               | `housekeeping/` (incl. room status history), `maintenance/`, `lost-found/`, `service-requests/`                                                                        |
| `finance/`       | Finance                                  | `folio/` (ledger), `payments/` (intents, holds, providers, refunds, webhooks, sandbox gateway), `cashier/`, `documents/` (invoices, receipts), `settings/`, `reports/` |
| `front-office/`  | Front Office                             | front desk, check-in/out, night audit and business days                                                                                                                |
| `hr/`            | Workforce and Time                       | `workforce/` (employees, departments, documents, records), `time/` (attendance, time clock, scheduling, staffing, leave, payroll export), `hr-access.ts` (shared)      |
| `guest-portal/`  | Guest Experience                         | guest session and guard, stay, pre-check-in, self check-in, room access, hotel info, guest portal settings                                                             |
| `fnb/`           | F&B                                      | outlets, menus, orders, room-service delivery                                                                                                                          |
| `privacy/`       | Shared kernel (import-export, files)     | data export and anonymization, CSV imports, hotel and menu images                                                                                                      |
| `devices/`       | Platform (ADR-0020)                      | device pairing, staff PINs, kiosk sign-in and clock                                                                                                                    |
| `calendar/`      | Engagement                               | events and the unified calendar                                                                                                                                        |
| `management/`    | Insights                                 | dashboards, property reports, global search                                                                                                                            |
| `jobs/`          | —                                        | scheduled per-tenant jobs (ADR-0017)                                                                                                                                   |

**Dependency rules** (`.dependency-cruiser.cjs`, run by `pnpm lint`):

- `API_CONTEXTS` lists the contexts in dependency order; a context may import only contexts
  listed before it. The context graph, and the Nest module imports that follow it, therefore
  cannot have a cycle, and no module needs `forwardRef`. Every context folder must be listed.
- Sub-folders of a context may not depend on each other in a cycle, except `hr/workforce` and
  `hr/time` (see below).
- Unchanged: no file cycles, and `common/`, `infrastructure/` and `config/` never import a
  context.

**OpenAPI stays stable.** Nest scans controllers module by module, which would reorder
`docs/api/openapi.json` whenever a controller moves. `apps/api/src/api-surface.ts` keeps the
ordered list of all controllers (`CONTROLLERS`, also the route inventory of the tenant
isolation suite), and the document's operations are ordered by it and by method declaration
order. A unit test checks the list matches the controllers the modules register. New
controllers go at the end of the list.

## Kept as they are

Routes, operation ids (`<Controller>_<method>`), tags and permissions are public contract and
did not change, so no route moved between controller classes. Some controllers therefore
still serve routes of more than one context and live in the context that owns most of them:

- `FrontOfficeController` also serves folio, tax-rule and housekeeping desk routes; it calls
  `FolioService` (Finance), `TaxRulesService` (Pricing) and `HousekeepingService`
  (Operations).
- `GuestServiceController` (staff service-request routes plus the guest portal link) and
  `GuestAdminController` (guest ID review, portal settings, guest messages) stay in
  `guest-portal/`; they call `ServiceRequestsService` (Operations) and
  `GuestIdentityService` (Guests).
- `HrController` (workforce) also serves leave balances and leave types, and
  `PropertyHrController` (time) also serves birthdays. Workforce and Time are therefore
  sub-folders of one `hr/` context and one `HrModule`, not two modules.
- `MeController` (self service) is in `hr/time/`; only its `/me/employee` route is
  workforce data.
- `InventoryController` serves rooms and rate plans, so it sits at the `pms/` root.

Moving these routes into controllers of their own context would change their operation ids
and tags. It can be done later together with the API clients.

## Consequences

- A context's public surface is its module's `exports`; injecting anything else fails at boot.
- Shutdown hooks now run by module distance: contexts (including the job processor) stop
  before the shared kernel closes Prisma and Redis.
