# ADR-0024: Notification center — in-app, email, SMS and reminders

- Status: Accepted, 2026-09-29
- Spec: §40 (notifications), §15 (background jobs), §51 (idempotency)
- Builds on ADR-0005 (outbox), ADR-0017 (scheduled tenant jobs)

## Decision

**Three channels, one rule: decide inside the business transaction, deliver outside it.**

- **In-app** (staff): a row per recipient membership in `notifications`, written in the
  same transaction as the change it announces. A rolled-back change never leaves a
  notification behind.
  - Members read only their own: `GET /me/notifications`, mark one or all read.
  - The staff app shows a bell with the unread count, polled every 30 seconds.
- **Email**: the existing queue and worker delivery (SES in the cloud).
- **SMS**: a new `sms` queue. The worker delivers through an `SmsTransport` port: a file
  transport in development (`MAIL_DIR/sms.log`), and Amazon SNS transactional SMS in the
  cloud.
  - Only E.164 numbers are sent (`+63 917 …` is normalized).
  - The worker never logs the text or the full number.
- Notifications are created by the API, not by worker event handlers. The worker runs
  with the system role, which cannot write tenant data (ADR-0017). Recipients depend on
  permissions, which the API already evaluates.

**Once only.** Guest messages and reminders reserve a key in `message_log`
(`booking-confirmation:{reservation}`, `checkin-reminder:{reservation}`,
`birthdays:{property}:{date}` …) before they are queued. The key is the primary key, so a
retry, a rerun of the daily job or a second worker never sends twice.

**What is sent now:**

| Event                                       | To                                   | Channel                         |
| ------------------------------------------- | ------------------------------------ | ------------------------------- |
| Booking created                             | Booker                               | Email and SMS                   |
| Booking fully cancelled                     | Booker                               | Email and SMS                   |
| Guest checked in                            | Guest (or booker)                    | Email                           |
| Online payment received                     | Booker                               | Email                           |
| Arrival tomorrow (daily, after 09:00 local) | Booker                               | Email with a fresh portal link  |
| Departure today (daily, after 09:00 local)  | Guest (or booker)                    | Email                           |
| Urgent maintenance reported                 | `maintenance.manage` at the property | In-app                          |
| Maintenance assigned                        | The technician                       | In-app                          |
| Leave requested                             | `leave.approve` at the property      | In-app                          |
| Leave decided                               | The employee                         | In-app, plus the existing email |
| Schedule published                          | Each employee with shifts            | In-app, plus the existing email |
| Attendance correction decided               | The employee                         | In-app                          |
| Guest service request assigned              | The assignee                         | In-app                          |
| Birthdays today (daily)                     | `employee.manage` at the property    | In-app                          |

- Birthdays respect the employee's visibility setting: hidden birthdays are never
  announced.
- The daily reminders are a new tenant job, `property.daily-reminders`, planned once per
  property and local date after 09:00 (`reminders:{property}:{date}`).

**Infrastructure:**

- The worker gets `SMS_TRANSPORT=sns` and permission to publish SMS. Publishing to a
  phone number has no resource ARN, so topic publishes are explicitly denied.
- The account must leave the SNS SMS sandbox, and set a spending limit, before guests
  receive texts.

## Consequences

- Messages are English templates. Other locales plug into the renderers by locale.
- Notification preferences (opt-outs per kind) and push notifications for the PWA are not
  built. The in-app list and email cover staff for now.
- Guests get no in-portal notification feed yet. Their messages are email and SMS.
- Attendance alerts (late, absent) and event reminders come with the events and reporting
  work.
