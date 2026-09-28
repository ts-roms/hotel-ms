# ADR-0028: Employee records, recurring shifts and minimum staffing

- Status: Accepted, 2026-10-02
- Spec: §33 (employee profile), §35 (shift scheduling)
- Builds on ADR-0006 (sensitive permissions need two-step verification), ADR-0013 (HR and
  scheduling)

## Decision

**Profile.**

- Employees gain an employment type: full time, part time, probationary, contractual,
  seasonal or intern. Everyone who can see the employee can see it; `employee.manage`
  changes it.
- The emergency contact (name, relationship, phone) is a personal detail. Like the birth
  date and personal contacts, it needs `employee.personal.read` to see or change.

**Records on the employee's file.**

| Record                         | See                                 | Record            | Notes                                                        |
| ------------------------------ | ----------------------------------- | ----------------- | ------------------------------------------------------------ |
| Pay (monthly, daily or hourly) | `employee.compensation` (sensitive) | same              | Start-dated; the latest start on or before today is current. |
| Trainings and certifications   | `employee.read`                     | `employee.manage` | Optional link to an uploaded employee document.              |
| Performance reviews            | `employee.performance` (sensitive)  | same              | Rating 1–5, summary, strengths, areas to improve, goals.     |

- Pay and reviews are never edited or deleted (the database grants only SELECT and
  INSERT). A mistake is corrected with a new record, and the history stays honest.
- Nobody can review themselves.
- The audit log records that pay changed and from when, but not the amounts.
- Both new permissions are in the HR administrator template (HR managers).
  Organization administrators have them too.
- Certifications show as valid, expiring (within 30 days) or expired. The daily
  organization job tells HR at the employee's properties, and the employee, 30 days
  before a certification expires and again on the day. Each notice is sent once.

**Recurring shifts.**

- One request plans the same shift (a template, or start and end times) for up to 50
  people, on chosen weekdays, across up to 92 days. The shifts are drafts sharing a
  series id.
- Days are skipped, not failed, when the person is not assigned to the property, is on
  approved leave, or already has an overlapping shift. The response lists what was
  skipped and why.
- A series can be cancelled from a date on. Shifts already started or in the past are
  never touched. Employees are told about cancelled published shifts, as for single
  shifts.

**Minimum staffing and understaffing.**

- A requirement says a department needs at least N people on shift at every moment of a
  local time window (overnight allowed) on chosen weekdays.
- Draft and published shifts of that department count, except for people on approved leave
  that day. Coverage is the fewest people on shift at any moment of the window, so a
  morning and an afternoon shift that hand over cover a long window together.
- `GET /schedule/coverage` lists the windows short of their minimum, with how many are
  scheduled and how many are published. The schedule marks those days.
- Publishing returns the gaps left in the published range. Understaffing is a warning,
  not a block, because the manager decides.

## Consequences

- Coverage is computed on request from indexed shift and leave queries. At a week or a
  month per property this is cheap.
- Not built:
  - pay components (allowances, deductions) and payroll calculation, since payroll stays
    an export (decision D7);
  - review workflows (self-assessment, sign-off);
  - editing a whole series in place (cancel and recreate instead).
