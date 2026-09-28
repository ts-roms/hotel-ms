# ADR-0025: Management layer — dashboards, reports, search, exports

- Status: Accepted, 2026-09-29
- Spec: §41–42 (reporting, group reporting), §66–67 (dashboards), §73 (search),
  §74 (exports)
- Builds on ADR-0004 (property-scoped RBAC), ADR-0012 (night audit statistics)

## Decision

**One endpoint per view; each section is gated by the permission guarding its data.**

- Dashboards are read models, computed on request. Each section appears only for
  properties where the caller holds the matching permission, so the same endpoint serves
  a general manager, the front desk and a housekeeper, and never shows more than their
  list screens would.

| Section                                                                           | Permission                                |
| --------------------------------------------------------------------------------- | ----------------------------------------- |
| Rooms: occupancy, arrivals, departures, new bookings                              | `reservation.read`                        |
| Money: revenue today and month-to-date                                            | `finance.report.read`                     |
| Staff today: scheduled, present, late, absent, on leave                           | `attendance.read`                         |
| Operations: dirty rooms, open and urgent maintenance, guest requests, food orders | `housekeeping.read` or `maintenance.read` |
| People: leave to approve, birthdays                                               | `leave.approve` or `employee.read`        |

- `GET /properties/:p/dashboard` is the property's day: rooms against the business date,
  staff against the property's local calendar date.
- `GET /dashboard` is the group view. It lists every property the caller can see, with
  today's occupancy, revenue today and month-to-date, and headcount, plus group totals.
  - Money is totalled only when all visible properties share a currency. Otherwise the
    total is null, rather than adding pesos to dollars.
  - Headcount counts an employee once per property they work at.
- Revenue means net charges: charges, adjustments and voids without tax lines, by business
  date. This is the same definition as the daily financial report.

**Reports** (`GET /properties/:p/reports/*?from&to`, at most one year), each with a CSV
export under `/export`:

- **Occupancy**: ADR, RevPAR, arrivals, departures and no-shows per closed business day.
  The figures come from the statistics the night audit froze when it closed the day, so
  the report never disagrees with the audit. Open days are excluded, and `closedDays`
  says how many counted. Bookings made and cancelled count by calendar date.
- **Food & beverage**: orders, sales, room-service and room-charged sales, average order,
  popular items, sales by outlet.
- **Guest services**: requests, open, completed, average time to complete, average rating,
  by category.
- **People**: headcount by department; attendance totals (present, late, absent, worked,
  overtime, undertime) from the same attendance rules as the attendance screen; approved
  leave days by type.

**Global search** (`GET /search?q=`, at least 2 characters):

- It covers reservations (confirmation number), guests (name, email, phone), rooms (number
  prefix), employees (number, name), orders, invoices and receipts, guest requests and
  maintenance.
- Each kind is searched only with its read permission, and only at the properties that
  permission covers. Guests are organization records, so they are found only through a
  reservation the caller can open.
- It returns at most 5 per kind, with a link to the screen that shows each result.

**UI:**

- The dashboard gains a "today across the group" table.
- Each property gets an Overview page, now the first property menu item and the landing
  page.
- The Reports page gains tabs with a date range and CSV links.
- A search box sits at the top of the navigation.

## Consequences

- Everything is computed on request with indexed queries. At the year-1 scale (ADR-0001:
  20 properties, 2,000 rooms) that is fine. Longer ranges or more properties would need
  nightly aggregates, filled by the scheduled jobs.
- Excel-specific exports and PDF reports are not built. CSV opens in Excel, and invoices
  and receipts already have printable pages.
- Department-level dashboards (spec §66) are covered by the role-gated sections, not by a
  separate view.
