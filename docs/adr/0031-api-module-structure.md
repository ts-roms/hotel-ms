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
- Sub-folders of a context may not depend on each other in a cycle.
- Unchanged: no file cycles, and `common/`, `infrastructure/` and `config/` never import a
  context.

**OpenAPI stays stable.** Nest scans controllers module by module, which would reorder
`docs/api/openapi.json` whenever a controller moves. `apps/api/src/api-surface.ts` keeps the
ordered list of all controllers (`CONTROLLERS`, also the route inventory of the tenant
isolation suite), and the document's operations are ordered by it and by method declaration
order. A unit test checks the list matches the controllers the modules register. New
controllers go at the end of the list, except a controller split off an existing one, which
goes next to it so the document's path order stays as it was.

## Routes served by the context that owns them

Every controller lives in the context whose service it calls. Routes that the first cut of
this ADR left in a neighbouring context's controller moved to a controller of their own
context (2026-09-29):

| Routes                                                                | From                     | To                                                           |
| --------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| a stay's folio, folio charges, payments, adjustments, voids           | `FrontOfficeController`  | `FolioController` (`finance/folio/`)                         |
| tax rules                                                             | `FrontOfficeController`  | `TaxRulesController` (`pms/pricing/`)                        |
| housekeeping board, housekeeping status, housekeeping staff and tasks | `FrontOfficeController`  | `HousekeepingController` (`operations/housekeeping/`)        |
| staff service-request routes                                          | `GuestServiceController` | `ServiceRequestsController` (`operations/service-requests/`) |
| guest ID review                                                       | `GuestAdminController`   | `GuestIdentityController` (`pms/guests/`)                    |
| rate plans and overrides, quote, availability                         | `InventoryController`    | `PricingController` (`pms/pricing/`)                         |
| leave balances and ledger entries, leave types                        | `HrController`           | `LeaveController` (`hr/time/`)                               |
| birthdays                                                             | `PropertyHrController`   | `BirthdaysController` (`hr/workforce/`)                      |

`InventoryController` now serves rooms only and moved to `pms/inventory/`. With leave in
`hr/time` and birthdays in `hr/workforce`, the two HR sub-folders no longer import each
other, and the sub-folder cycle rule has no exception left. They stay one `hr/` context and
one `HrModule` (they share `hr-access.ts`).

**Contract change.** Paths, methods, permissions, request and response schemas and status
codes did not change. The moved operations' ids changed with their controller class
(`<Controller>_<method>`, e.g. `FrontOfficeController_postCharge` →
`FolioController_postCharge`; method names were kept). Their tags changed where the old tag
named another context: folio routes are tagged `finance`, tax rules and rate plans
`pricing`, housekeeping `housekeeping`, guest ID review `guests`; service-request, leave and
birthday routes kept `guest service`, `hr` and `hr: property`. The night-audit and
business-day paths now follow the check-in/out routes in the document, ahead of the folio
routes. Clients that key on operation ids or tags must be regenerated.

Still served across a boundary:

- `GuestServiceController` keeps only the guest portal link, and `GuestAdminController`
  portal settings and staff messages to a guest; both stay in `guest-portal/`. The message
  route calls `GuestInboxService` (Messaging), which comes before `guest-portal` in
  `API_CONTEXTS`.
- `MeController` (self service) is in `hr/time/`; its `/me/employee` route answers from
  `AttendanceService` (Time), which reads the employee record through `HrAccess`
  (shared by both HR sub-folders).

## Writes to another context's tables

A context writes only its own tables (blueprint §6.2). When a use case changes another
context's rows, it calls a method of that context's exported service that takes the
caller's transaction (`...InTx(tx, ...)`), so the whole use case still commits or rolls
back together. The caller keeps the rules of its use case and records its audit entry and
event. Examples:

- Guest pre-check-in (`guest-portal/`) → `ReservationsService` (arrival time, guest
  requests) and `GuestsService` (phone).
- Check-in, check-out and night audit (`front-office/`) → `ReservationsService` (line
  status, early departure, no-shows), `FolioService` (closing the folio),
  `HousekeepingService` (cleaning tasks), `ServiceRequestsService` (the guest's checkout
  request) and `RoomsService` (housekeeping status).
- A room's housekeeping status, with its status history row and `RoomStatusChanged`
  event, is written by `RoomsService` (Inventory owns `rooms`); housekeeping checks the
  transition first.
- CSV room import (`privacy/`) → `RoomsService`; menu item photos → `MenuService`.

Known exceptions:

- **Night audit advances `properties.current_business_date`** (a Tenancy table). The night
  audit owns the business date (ADR-0008, ADR-0012) and advances it in its own
  transaction, under the lock on the property row that serializes audits.
- **Data export and anonymization** (`privacy/`, ADR-0030) rewrite personal data in every
  context's tables by design; they are shared-kernel tooling, not a domain.
- **Settings tables** (`property_settings`, `organization_settings`) are key-value stores;
  each context writes only its own keys (payments, guest portal, time clock, employee
  documents).
- **Access writes identities**: adding a member and accepting an invitation create the
  global identity and its first credential. Access comes before Platform in
  `API_CONTEXTS`, so it cannot call `auth/`.
- **Kiosk sign-in** (`auth/kiosk-auth.ts`, a global guard) refreshes `last_seen_at` on
  `devices` and `device_sessions` (ADR-0020); `auth/` comes before `devices/` in
  `API_CONTEXTS`.
- `hr/workforce` cancels future shifts in `hr/time` when an assignment ends: both are
  sub-folders of the one `hr/` context.

## Consequences

- A context's public surface is its module's `exports`; injecting anything else fails at boot.
- Shutdown hooks now run by module distance: contexts (including the job processor) stop
  before the shared kernel closes Prisma and Redis.
