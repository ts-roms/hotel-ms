/**
 * How long ago an instant was, bucketed the way feeds show it. Apps turn the bucket into
 * their own words ("5 min" for staff, "5 min ago" for guests).
 */
export type Elapsed =
  | { unit: 'now' }
  | { unit: 'minutes'; value: number }
  | { unit: 'hours'; value: number }
  | { unit: 'days' };

export function elapsed(iso: string, now: number = Date.now()): Elapsed {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return { unit: 'now' };
  if (minutes < 60) return { unit: 'minutes', value: minutes };
  const hours = Math.round(minutes / 60);
  return hours < 24 ? { unit: 'hours', value: hours } : { unit: 'days' };
}
