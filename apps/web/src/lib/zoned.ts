/**
 * Property-local wall-clock time ↔ instants in the browser, whatever the browser's own time
 * zone (same algorithm as the API's zoned-time helpers).
 */

function parts(instant: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
}

/** The local calendar date and "HH:mm" of an instant in a time zone. */
export function toZoned(iso: string, timeZone: string): { date: string; time: string } {
  const p = parts(new Date(iso), timeZone);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The ISO instant at which the wall clock in `timeZone` shows `date` `time`. */
export function fromZoned(date: string, time: string, timeZone: string): string {
  const naive = Date.parse(`${date}T${time}:00Z`);
  let guess = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  guess = naive - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess).toISOString();
}
