# ADR-0026: Events and the unified calendar

- Status: Accepted, 2026-09-30
- Spec: §38 (events), §39 (calendar)
- Builds on ADR-0004 (property-scoped RBAC), ADR-0024 (notifications)

## Decision

**Events are property records with invited staff.**

- An event has a title, category, start and end instants (all-day events run from local
  midnight to local midnight), location, description, and a `guestVisible` flag.
  Categories: hotel event, meeting, training, conference, maintenance, employee activity,
  group event, guest activity.
- `event.manage` (property managers, HR admins) creates, changes and cancels events, with
  If-Match versions. Cancelled events are kept, frozen, and drop off the calendar.
- Participants must be members who can see the property. They are told in-app when invited,
  when the time or place changes, and when the event is cancelled. The person making the
  change is not notified. Each morning's reminder job also tells participants about the
  day's events, once per event and day.
- `event.read` is part of self-service, so every employee sees the property's events.

**One calendar endpoint, each kind gated by its own permission.**

`GET /properties/:p/calendar?from&to` (at most 62 days) merges:

| Kind                   | Shown with                                                  |
| ---------------------- | ----------------------------------------------------------- |
| Arrivals, departures   | `reservation.read`                                          |
| Shifts (published)     | `schedule.read` for everyone's; `schedule.read.own` for own |
| Approved leave         | `leave.read` for everyone's, with type; otherwise only own  |
| Birthdays              | `birthday.read`, and only when the employee shows theirs    |
| Events (not cancelled) | `event.read`                                                |
| Rooms out of order     | `room.read`                                                 |

- Items carry a link to the screen that owns them. The calendar never shows more than
  those screens would.
- Times are instants, and all-day items are local dates with an exclusive end. The browser
  renders them in the property's time zone, whatever its own.

**Guests** see guest-visible, scheduled events of the next 30 days (`GET /guest/events`),
with no organizer or participants.

**UI:**

- The staff web uses FullCalendar 7 (MIT: month, week and list views; classic theme), with
  toggles per kind.
- A side panel creates and edits events. Participants are picked from the staff who can
  see the property.
- The guest portal shows a "What's on" card for upcoming and in-house guests.

## Consequences

- The calendar is computed on request. Each kind is capped at 500 items per range, which
  covers a month at year-1 scale.
- Recurring events, room or venue booking with conflict checks, and calendar feeds (iCal)
  are not built.
