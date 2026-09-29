import { z } from 'zod';
import { amountMinorSchema, localDateSchema, MAX_STAY_NIGHTS, nightsBetween } from './common.js';
import { codeSchema } from './internal.js';

/**
 * Pricing contracts (blueprint §12): rate plans, overrides, quotes and tax rules.
 *
 * Money is an integer number of minor units (e.g. centavos) plus a currency; never a
 * float. Stay dates are property-local calendar dates "YYYY-MM-DD"; departure dates are
 * exclusive (the guest does not stay that night).
 */

/** Revenue departments that charges are posted to and taxes apply to. */
export const DEPARTMENTS = [
  'ROOM',
  'FNB',
  'MINIBAR',
  'LAUNDRY',
  'TRANSPORT',
  'SPA',
  'MISC',
] as const;

// ---- Rates -------------------------------------------------------------------------------

export const ratePlanSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  cancellationPolicy: z.string(),
  currency: z.string(),
  archived: z.boolean(),
  prices: z.array(z.object({ roomTypeId: z.uuid(), baseAmountMinor: amountMinorSchema })),
  version: z.number().int(),
});
export type RatePlan = z.infer<typeof ratePlanSchema>;

const pricesSchema = z
  .array(z.strictObject({ roomTypeId: z.uuid(), baseAmountMinor: amountMinorSchema }))
  .max(100)
  .refine((prices) => new Set(prices.map((p) => p.roomTypeId)).size === prices.length, {
    message: 'Each room type may appear once',
  });

export const createRatePlanRequestSchema = z.strictObject({
  code: codeSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).default(''),
  cancellationPolicy: z.string().trim().max(2000).default(''),
  prices: pricesSchema.default([]),
});
export type CreateRatePlanRequest = z.infer<typeof createRatePlanRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type CreateRatePlanRequestInput = z.input<typeof createRatePlanRequestSchema>;

export const updateRatePlanRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1000),
    cancellationPolicy: z.string().trim().max(2000),
    /** Replaces the full price list. */
    prices: pricesSchema,
  })
  .partial();
export type UpdateRatePlanRequest = z.infer<typeof updateRatePlanRequestSchema>;

export const setRateOverridesRequestSchema = z
  .strictObject({
    roomTypeId: z.uuid(),
    from: localDateSchema,
    /** Exclusive. */
    to: localDateSchema,
    /** null removes overrides in the range (back to the base price). */
    amountMinor: amountMinorSchema.nullable(),
  })
  .refine((v) => v.to > v.from, { message: 'to must be after from', path: ['to'] });
export type SetRateOverridesRequest = z.infer<typeof setRateOverridesRequestSchema>;

export const nightPriceSchema = z.object({ date: localDateSchema, amountMinor: amountMinorSchema });

export const quoteQuerySchema = z
  .object({
    roomTypeId: z.uuid(),
    ratePlanId: z.uuid(),
    arrivalDate: localDateSchema,
    departureDate: localDateSchema,
  })
  .refine((v) => v.departureDate > v.arrivalDate, {
    message: 'Departure must be after arrival',
    path: ['departureDate'],
  })
  .refine((v) => nightsBetween(v.arrivalDate, v.departureDate) <= MAX_STAY_NIGHTS, {
    message: `A stay can be at most ${MAX_STAY_NIGHTS} nights`,
    path: ['departureDate'],
  });
export type QuoteQuery = z.infer<typeof quoteQuerySchema>;

export const quoteSchema = z.object({
  currency: z.string(),
  nights: z.array(nightPriceSchema),
  totalMinor: amountMinorSchema,
});
export type Quote = z.infer<typeof quoteSchema>;

// ---- Availability ---------------------------------------------------------------------------

export const availabilityQuerySchema = z
  .object({ from: localDateSchema, to: localDateSchema })
  .refine((v) => v.to > v.from, { message: 'to must be after from', path: ['to'] });
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const availabilitySchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  roomTypes: z.array(
    z.object({
      roomTypeId: z.uuid(),
      code: z.string(),
      name: z.string(),
      nights: z.array(
        z.object({
          date: localDateSchema,
          capacity: z.number().int(),
          sold: z.number().int(),
          blocked: z.number().int(),
          available: z.number().int(),
        }),
      ),
    }),
  ),
});
export type Availability = z.infer<typeof availabilitySchema>;

// ---- Taxes -----------------------------------------------------------------------------

export const taxRuleSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  rateBps: z.number().int(),
  inclusive: z.boolean(),
  departments: z.array(z.enum(DEPARTMENTS)),
  archived: z.boolean(),
});
export type TaxRule = z.infer<typeof taxRuleSchema>;

export const createTaxRuleRequestSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9_]{1,16}$/),
  name: z.string().trim().min(1).max(80),
  /** Basis points: 1200 = 12%. */
  rateBps: z.number().int().min(0).max(10_000),
  /** Prices already include this tax (typical for VAT in the Philippines). */
  inclusive: z.boolean(),
  departments: z.array(z.enum(DEPARTMENTS)).min(1),
});
export type CreateTaxRuleRequest = z.infer<typeof createTaxRuleRequestSchema>;
