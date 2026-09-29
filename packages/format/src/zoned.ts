/**
 * Property-local wall-clock time ↔ instants, whatever the runtime's own time zone, with the
 * IANA time zone database built into Intl. Shifts are planned in local time and stored as
 * instants (blueprint §13.3). Shared by the API, the worker and the web apps.
 */

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatter.set(timeZone, formatter);
  }
  return formatter;
}

/** The local calendar date and "HH:mm" of an instant in a time zone. */
export function toLocal(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** Offset of the time zone from UTC at an instant, in minutes (east positive). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The instant at which the wall clock in `timeZone` shows `date` `time`. In a DST gap the
 * later valid instant is returned; in an overlap, the earlier one.
 */
export function fromLocal(date: string, time: string, timeZone: string): Date {
  const naive = Date.parse(`${date}T${time}:00Z`);
  // Two passes converge for every real-world zone (offset changes at most once nearby).
  let guess = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  guess = naive - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess);
}

/**
 * Today's calendar date in a time zone (a property's, so "today" follows the hotel and not the
 * device). Without one, the runtime's own zone is used.
 */
export function localToday(timeZone?: string, now = new Date()): string {
  return toLocal(now, timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone).date;
}

/** `toLocal` for an ISO string, as the API sends instants. */
export function toZoned(iso: string, timeZone: string): { date: string; time: string } {
  return toLocal(new Date(iso), timeZone);
}

/** `fromLocal` as an ISO string, as the API accepts instants. */
export function fromZoned(date: string, time: string, timeZone: string): string {
  return fromLocal(date, time, timeZone).toISOString();
}
