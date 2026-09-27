/**
 * Property-local calendar dates ("YYYY-MM-DD") as used for stays and business dates.
 * Stored in PostgreSQL `date` columns, which Prisma maps to Date at UTC midnight; these
 * helpers keep all arithmetic in that UTC-midnight space so time zones never shift a day.
 */
const DAY_MS = 86_400_000;

export function toDbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  return fromDbDate(new Date(toDbDate(isoDate).getTime() + days * DAY_MS));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / DAY_MS);
}

/** Each night of a stay: arrival inclusive, departure exclusive. */
export function nightsOf(arrival: string, departure: string): string[] {
  const nights: string[] = [];
  for (let date = arrival; date < departure; date = addDays(date, 1)) nights.push(date);
  return nights;
}
