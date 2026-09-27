# ADR-0014: HR: people, scheduling, attendance and leave

- Status: Accepted, 2026-09-27
- Blueprint: §13 (HR architecture), §7.4 (database-enforced rules), §8 (RBAC)

## Decision

**People.**

- `employees` are organization records with a unique `employee_no`.
- `employment_assignments` place an employee at a property, department and position over a
  date range. The end date is the last working day, inclusive.
- An exclusion constraint allows one assignment per employee and property at a time.
- A partial unique index allows one open primary assignment.
- Every employee is created with an assignment, so someone in scope can always see them.
- A staff login links through `employees.membership_id`. The link is optional both ways.
  Only organization-scope HR can link logins.
- Terminating an employee ends their open assignments and cancels their future shifts.

**Scope.**

- A property-scoped HR permission covers the employees with an assignment at that
  property, past assignments included, so HR keeps seeing their history.
- Employees outside the caller's scope answer 404, like other tenants' records.
- Personal details (birth date, personal contacts) need `employee.personal.read`. It is
  sensitive: it requires an MFA-verified session, which `HrAccess` checks for
  permissions evaluated inside a handler. The record is still returned without them.
- The audit log records which personal fields changed, never their values.

**Scheduling** (§13.3).

- Shift templates hold property-local "HH:mm" times.
- A shift stores instants computed with the property's IANA zone, so an overnight or DST
  shift has its real length (`common/zoned-time.ts`, unit-tested on New York's DST
  changes).
- The database refuses double-booking: an exclusion constraint on
  `(employee_id, tstzrange)` for non-cancelled shifts.
- Shift length is capped at 16 hours, and the break must be shorter than the shift.
- On create and edit the API returns warnings instead of refusing:
  - approved leave that day;
  - less than 8 hours of rest (a constant for now).
- Shifts start as DRAFT. Publishing a date range makes them PUBLISHED, emits
  `SchedulePublished` and emails each affected employee their shifts.
- Editing or cancelling a published shift emits `ShiftChanged` and is audited.
- Employees see only published shifts.

**Attendance** (§13.2).

- Raw punches are append-only: grants, plus the `forbid_mutation` trigger.
- One employee's punches are serialized with a row lock on the employee.
- A small state machine sets which punch may come next: IN → BREAK_START/OUT, and so on.
- An open shift older than 18 hours no longer blocks clocking in, so a forgotten
  clock-out cannot lock anyone out. That day shows INCOMPLETE until corrected.
- Punching needs an active assignment at the property today.
- Daily attendance is computed at query time by a pure function
  (`attendance-rules.ts`, unit-tested):
  - punches pair into sessions;
  - sessions attach to the published shift they fall in (from 4 h before its start);
  - late (beyond a 5-minute grace), undertime and overtime follow;
  - the status is PRESENT, ABSENT, INCOMPLETE, SCHEDULED or ON_LEAVE.
- Computing on read means corrections and schedule edits never leave stale summaries.
  If payroll export needs it, a materialized `attendance_days` can come later.
- Corrections are requests. Approving one adds a punch with `source = CORRECTION`, and
  the original punches are never edited.
- Nobody decides their own correction.

**Leave** (§13.4).

- `leave_ledger` is the source of truth. It is append-only and signed by kind:
  ACCRUAL/REVERSAL > 0, USAGE < 0, ADJUSTMENT ≠ 0.
- A usage or reversal must reference its request, at most once each.
- The ledger stores integer half-days, so balances are exact.
- `leave_balances` is maintained by an AFTER INSERT trigger in the posting statement, like
  the folio balance.
- Requesting checks:
  - the leave type's minimum notice, in the property's zone;
  - overlap with the employee's own pending and approved leave;
  - the balance net of pending requests, unless the type allows negative balances.
- A request is routed to the property where the employee works on its first day, primary
  assignment first.
- Approval is guarded by a version predicate: of two concurrent approvers, one wins and
  the other gets 409/412.
- On approval, the ledger is debited under a `FOR UPDATE` lock on the balance row, and the
  balance is re-checked.
- The response lists the employee's shifts that now clash, and `LeaveApproved` carries
  their ids.
- Nobody approves their own leave.
- The employee is emailed the decision.
- Cancelling approved leave before it starts posts a REVERSAL.
- The Philippine pack (SIL 5, VL 10 with 3 days' notice, SL 7) is demo seed
  configuration, never code.

**Calendar privacy and birthdays** (§13.5).

- In the schedule view, colleagues see approved leave as "Unavailable". Only
  `leave.read` shows the leave type.
- Birthdays list day and month of colleagues at the property who opted in
  (`DAY_MONTH`). The year never leaves the HR record.

**Permissions and roles.**

- New permissions:
  - `department.manage` and `leave.configure` (organization only);
  - `employee.read|manage`, `employee.personal.read` (sensitive);
  - `schedule.read|manage`, `attendance.read|manage`;
  - `leave.read|approve|manage`, `birthday.read`;
  - the self-service trio `schedule.read.own`, `attendance.punch.own`,
    `leave.request.own`.
- A new `hr_manager` template.
- General managers get people management, without personal details.
- Auditors get HR read access.
- Every operational template gets self-service.
- Existing organizations get new templates through `addMissingTemplateRoles`, run by the
  seed/migrate task. The system role finds organizations lacking a template, and the role
  is created in that organization's own tenant context. A custom role already using the
  key is left alone.

## Consequences

- Covered by tests:
  - API integration (17 tests): scope, MFA-gated personal data, overlaps, publishing and
    email, clock state machine, corrections, leave notice/balance/overlap, concurrent
    approval, reversal, calendar privacy, birthdays;
  - DB integration: exclusion constraints, ledger signs and balance trigger, template
    backfill;
  - unit: zoned time, attendance rules;
  - the route inventory's 401/404 isolation checks, which now also run on every HR
    route.
- Not built yet:
  - multi-step approval chains (single approver per property for now);
  - accrual schedules (HR posts accruals);
  - rest-period and grace settings per organization;
  - understaffing warnings;
  - QR/PIN/kiosk and biometric punches (the `KIOSK` source is reserved);
  - employee documents, government IDs and compensation (need S3 and envelope
    encryption, §20.3);
  - payroll export (D7);
  - partitioning `attendance_punches` (no table is partitioned yet; revisit with volume).
