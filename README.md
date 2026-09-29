# Hotel Platform

A multi-tenant cloud hotel management platform (PMS, guest experience, F&B, HR, finance) built
as a modular monolith. Start with the
[Production System Blueprint](docs/architecture/00-production-system-blueprint.md) and the
[decision records](docs/adr/).

**Status: Phase 1 (foundation) complete.**

- Tenancy with row-level security.
- Property-scoped RBAC with anti-escalation rules.
- Staff member and role administration with email invitations.
- TOTP two-step verification with recovery codes, password reset and change.
- Audit log, transactional outbox and background email delivery.
- Terraform for AWS staging, and deploy pipelines.

Phase 2 (PMS core): room setup, rates, availability, guest profiles, reservations with room
assignment (ADR-0011), check-in/out, the folio ledger with taxes and payments, housekeeping and
the night audit (ADR-0012).

## Layout

```
apps/
  api/        NestJS 12 + Fastify REST API (/api/v1, OpenAPI at /api/docs in dev)
  worker/     Outbox relay + BullMQ event consumers
  web/        Next.js 16 staff portal (proxies /api/v1 to the API)
  guest/      Next.js 16 guest portal PWA (proxies only /api/v1/guest to the API)
packages/
  contracts/  Zod schemas, permission catalog, error codes, event types (shared by all)
  database/   Prisma schema (one file per bounded context), migrations incl. RLS, seed,
              password hashing; @hotel/database/testing is the test harness
  api-client/ Hand-written typed clients for the staff, guest and kiosk apps (+ ./react)
  format/     Money, date, time zone and relative-time formatting for the staff and guest apps
  i18n/       Message catalogs for the staff and guest apps (formatting lives in @hotel/format)
  ui/         Shared shadcn-style components and theme.css design tokens
docs/         Architecture blueprint, ADRs, database conventions, generated OpenAPI
infrastructure/docker/     Local Postgres roles, multi-target Dockerfile
infrastructure/terraform/  AWS platform module + staging root (ADR-0010)
scripts/deploy/            ECS deploy helpers used by the deploy workflows
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

Then run the API, worker, web app and (optionally) the guest portal, each in its own terminal:

```bash
pnpm --filter @hotel/api dev
```

```bash
pnpm --filter @hotel/worker dev
```

```bash
pnpm --filter @hotel/web dev
```

```bash
pnpm --filter @hotel/guest dev
```

Open http://localhost:43100. With the worker running, emails (password reset, invitations)
are written to `apps/worker/.mail/` instead of being sent.

Administrative actions (members, roles, audit log) need two-step verification: enable it
under **Security** with any authenticator app. The seed creates two organizations and several users that cover
the access-scope cases (org admin, single-property GM, multi-property user, org-wide auditor,
multi-organization consultant). They are listed in `packages/database/src/seed/demo-world.ts`,
together with the shared development password. Demo data is never seeded when
`NODE_ENV=production`.

HR (employees, schedule, attendance, leave) is under **Employees**, **My time** and the
property **Schedule**, **Attendance** and **Leave** pages; `maria.hr@abc.test` is the demo HR
manager and most demo staff logins are linked to employee records.

F&B lives under the property **Kitchen**, **Orders** and **Menus** pages (`kitchen@abc.test` and
`runner@abc.test` are the demo kitchen and room-service runner). Checked-in guests order room
service from the guest portal; delivered room charges land on their folio.

Finance: folios take online payments through the built-in **sandbox gateway** (payment links for
staff, **Pay now** for guests; no money moves), refunds, invoices and receipts. Cash needs an open
shift on the **Cashier** page; **Accounts** holds company folios; **Reports** has the daily report
and reconciliation. **Finance settings** holds exchange rates for foreign cash, the statutory
discount profiles (senior citizen and PWD are seeded), and an optional card hold that guests
authorize before self check-in (ADR-0018). In the sandbox, refunds ending in 13 centavos stay
pending until a refund webhook arrives.

HR keeps employee documents (contracts, IDs, certificates) on the employee page. They need the
`employee.documents` permission with two-step verification. Files go to `.data/storage` locally,
and to an SSE-KMS encrypted S3 bucket in the cloud (ADR-0019). **Document retention** (HR) deletes a
category's documents a set number of months after an employee leaves (ADR-0021).

The dashboard shows today across the group; each property has an **Overview**, and **Reports**
has occupancy (ADR/RevPAR), F&B, guest-service and people reports with CSV export. The search box
finds guests, bookings, rooms, staff, orders and documents you may see (ADR-0025).

Each property has a **Calendar**: arrivals, departures, shifts, leave, birthdays, events and
rooms out of order in one month, week or list view, each shown as far as your permissions reach.
Managers schedule events there and invite staff; guest-visible events appear in the guest portal
under "What's on" (ADR-0026).

In the guest portal, guests can upload an ID for the front desk to approve (**Guest IDs**, which needs
two-step verification). They also see hotel information and updates about their requests and
orders, and can request checkout. **Guest portal** settings hold the hotel information and can
require an approved ID before self check-in. ID files are deleted 30 days after the stay (ADR-0027).

An employee's page also holds the employment type, emergency contact, **pay history** and
**performance reviews** (both need two-step verification), and **training and certifications**
with expiry reminders. On the schedule, **Repeat a shift** plans the same shift on chosen weekdays
for several people. **Minimum staffing** marks understaffed days, which are also reported when
publishing (ADR-0028).

**Operations** (ADR-0029): traces go to X-Ray through OpenTelemetry and errors to Sentry when
configured. Platform operators get an ops dashboard at `/ops` (queues, outbox, webhooks), granted
with `OPERATOR_EMAIL=... OPERATOR_ACTION=grant pnpm --filter @hotel/database ops:operator`.
`docs/operations/restore.md` is the restore runbook; `scripts/ops/restore-drill.sh` rehearses it.
Browser tests live in `tests/e2e`: start the stack, then `pnpm --filter @hotel/e2e e2e`.

**Data requests** (organization administrators, two-step verification) download everything held
about a guest or employee, or anonymize them where the law allows. **Import** loads guests or rooms
from CSV after a preview. Hotel photos (Guest portal settings) and menu item photos appear in the
guest portal, re-encoded without location data (ADR-0030).

Staff see in-app notifications under the bell (urgent maintenance, assignments, leave, schedules,
birthdays). Guests get booking, check-in, payment and reminder emails, and SMS where a phone is
on file (ADR-0024). Locally, emails are files in `.mail/` and texts go to `.mail/sms.log`.

**Maintenance** tracks problems from report to fix (assign, start, hold, complete, photos, history);
a request can take a room out of order until it is closed. **Lost & found** logs items until they
are returned or disposed of (ADR-0023).

Kitchen tablets: a manager adds a device under **Devices** and gets a pairing code. On the tablet,
open http://localhost:43100/kiosk and enter the code. Staff then sign in there with the PIN they
set under **Security**, and see the kitchen board with the device's permissions only (ADR-0020).
A **time clock** device (same pairing) lets staff clock in and out with their Employee ID; the
camera takes a selfie with each punch (web punches under **My time** need one too), reviewed on the
Attendance page and deleted after 90 days by default (set under **Retention**)
(ADR-0022).

To try the guest portal, open a confirmed reservation with a booker email in the staff app
and choose **Send guest portal link**; the link in the email opens http://localhost:43200.

Local ports: Postgres 55432, cache Redis 56379, queue Redis 56380, API 48100, web 43100,
guest 43200.

## Checks

| Command                 | What it runs                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm lint`             | ESLint, including tenant-safety rules (no raw Prisma clients or unsafe SQL in apps)                       |
| `pnpm typecheck`        | TypeScript across all packages                                                                            |
| `pnpm test`             | Unit tests                                                                                                |
| `pnpm test:integration` | Real Postgres/Redis: RLS suite, API isolation route matrix, outbox relay. Uses the `hotel_test` database. |
| `pnpm format:check`     | Prettier                                                                                                  |

CI (`.github/workflows/ci.yml`) runs all of these. It also runs a schema-drift check, a
stale-OpenAPI check, `pnpm audit`, Terraform fmt/validate, a Trivy config scan, actionlint,
shellcheck and container image builds. After CI passes on `main`, `deploy-staging.yml`
deploys to staging. Production deploys are manual and approval-gated
(`deploy-production.yml`). To set up staging for the first time, see
[docs/operations/staging-setup.md](docs/operations/staging-setup.md).

## Rules that are easy to break

- Tenant data is only reached through `TenantDb` (API) or `withDbContext` (worker, seed).
  See [ADR-0003](docs/adr/0003-tenant-isolation.md).
- Every tenant route declares `@RequirePermission(...)`. Routes without one are denied.
- New tables follow [database conventions](docs/database/conventions.md), including the RLS
  migration. The integration suite fails otherwise.
- Changes to data are audited and emit events **inside the same transaction**
  ([ADR-0005](docs/adr/0005-audit-and-outbox.md)).
