import { z } from 'zod';

export const uuidSchema = z.uuid();

/** IANA time zone, validated against the runtime's tz database. */
export const timeZoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Unknown IANA time zone' },
);

/** ISO 4217 currency code. */
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Must be an ISO 4217 code');

/** BCP 47 locale tag, e.g. en-PH. */
export const localeSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Must be a locale like en-PH');

/** ISO 3166-1 alpha-2 country code. */
export const countrySchema = z.string().regex(/^[A-Z]{2}$/, 'Must be an ISO 3166-1 alpha-2 code');

/** Local wall-clock time HH:mm. */
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:mm');

/** Calendar date YYYY-MM-DD (property-local business date). */
export const localDateSchema = z.iso.date();

export const cursorPageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

export function cursorPage<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/** Unpaginated list envelope: `{ items: T[] }`. */
export function listOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item) });
}

/** A staff member as shown in pickers and assignee fields. */
export const staffRefSchema = z.object({ membershipId: z.uuid(), displayName: z.string() });
export type StaffRef = z.infer<typeof staffRefSchema>;

/** Money: a non-negative integer number of minor units (e.g. centavos), never a float. */
export const amountMinorSchema = z.number().int().min(0).max(1_000_000_000_000);
