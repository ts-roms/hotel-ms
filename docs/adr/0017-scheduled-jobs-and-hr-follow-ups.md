# ADR-0017: Scheduled tenant jobs, two-step leave approval, accruals and payroll export

- Status: Accepted, 2026-09-28
- Blueprint: §13.4 (leave), §15.1 (nightly reconciliation), §17 (background work); decision
  D7 (payroll is exported, not computed)

## Decision

**Scheduling is split between the worker and the API.**

- The **worker** plans jobs from the clock every 5 minutes (`SCHEDULER_INTERVAL_MS`). It
  runs with the system role, which may now read exactly:
  - `properties(id, organization_id, timezone, status)`;
  - `organizations(id, default_timezone, status)`.
    It still cannot read names or any business data; a test checks this.
- It queues `TenantJob`s on `tenant-jobs`, with deterministic job ids:
  - `nightly:{property}:{local date}`, due after 03:00 property-local time;
  - `accrual:{organization}:{YYYY-MM}`.
    Planning twice, or on several worker replicas, therefore queues a job once.
- The **API** runs the jobs (`TenantJobsProcessor`, BullMQ, concurrency 2) inside a fresh
  request context for the job's organization, as the SYSTEM actor. All domain logic stays
  in the API, and RLS applies as for any request.
- Every job is also idempotent in the database, because queue de-duplication only lasts
  while the job is retained:
  - `reconciliation_runs` is unique per property and date;
  - scheduled accruals are unique per employee, type and period.
- `TENANT_JOBS_ENABLED=false` turns the runner off (tests, OpenAPI generation). Tests call
  the runner directly.

**Nightly reconciliation.**

- Runs the reconciliation checks from ADR-0016 for each property and stores the result.
- Emits `ReconciliationCompleted`.
- The Reports page lists recent runs (`GET /reports/reconciliation-runs`).

**Monthly accrual.**

- Leave types get `accrualDaysPerMonth`, in steps of 0.5 day like the ledger.
- On the organization's first run of a month, every ACTIVE employee hired by month end
  receives an ACCRUAL entry for each accruing type.
- The entries carry `accrual_period`, and a partial unique index makes reruns no-ops.

**Two-step leave approval.**

- Leave types get `hrApprovalRequired`. Requests of those types need two approvals:
  - step 1, the manager, with `leave.approve` at the property;
  - step 2, HR, with `leave.manage` covering the employee.
- The second approver must be a different person from the first. Nobody can approve their
  own leave in any case.
- Each decision is an append-only `leave_approvals` row, unique per request and step. The
  request keeps `approval_step`, and a version plus step predicate stops races.
- Only the final approval debits the ledger, reports clashing shifts and emails the
  employee. A rejection at any step ends the request.

**Payroll export.**

- `GET /properties/:p/payroll-export?from&to` returns CSV, at most 62 days. It needs
  `payroll.export`, which is sensitive, so an MFA-verified session is required.
- One row per employee and day:
  - attendance status;
  - shift, first in and last out;
  - worked, break, late, undertime and overtime minutes;
  - approved leave type and whether it is paid.
- Fields are RFC 4180 quoted. Text starting with `= + - @` is prefixed with `'` against
  spreadsheet formula injection.
- Every export is audited.

## Consequences

- Covered by tests:
  - the planner (local time, idempotency, still no business data for the system role);
  - both jobs (once only, per tenant);
  - the approval chain (roles, different people, rejection, a single ledger debit);
  - the export (content, leave columns, permission and MFA, range limit);
  - CSV escaping.
- Not built yet:
  - approval chains longer than two steps;
  - pro-rated accrual for mid-month hires;
  - accrual caps and carry-over and expiry rules;
  - e-mailing reconciliation issues (they are recorded and emitted as an event).
