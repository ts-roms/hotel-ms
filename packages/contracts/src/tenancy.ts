import { z } from 'zod';
import {
  countrySchema,
  currencySchema,
  localDateSchema,
  localeSchema,
  localTimeSchema,
  timeZoneSchema,
} from './common.js';

/** Tenancy contracts: properties and organization feature flags. */

export const PROPERTY_STATUSES = ['ONBOARDING', 'ACTIVE', 'INACTIVE'] as const;

export const propertySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  brandId: z.uuid().nullable(),
  code: z.string(),
  name: z.string(),
  status: z.enum(PROPERTY_STATUSES),
  timezone: z.string(),
  currency: z.string(),
  locale: z.string(),
  countryCode: z.string(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  checkInTime: z.string(),
  checkOutTime: z.string(),
  currentBusinessDate: localDateSchema,
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Property = z.infer<typeof propertySchema>;

const propertyCodeSchema = z
  .string()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,15}$/, 'Uppercase letters, digits and dashes (2-16 chars)');

/** Editable profile fields. No defaults here: a PATCH must never reset omitted fields. */
const propertyProfileFields = {
  name: z.string().trim().min(2).max(120),
  brandId: z.uuid().nullable(),
  locale: localeSchema,
  countryCode: countrySchema,
  addressLine1: z.string().trim().max(200).nullable(),
  addressLine2: z.string().trim().max(200).nullable(),
  city: z.string().trim().max(100).nullable(),
  region: z.string().trim().max(100).nullable(),
  postalCode: z.string().trim().max(20).nullable(),
  phone: z.string().trim().max(40).nullable(),
  email: z.email().nullable(),
  checkInTime: localTimeSchema,
  checkOutTime: localTimeSchema,
};

export const createPropertyRequestSchema = z.strictObject({
  ...propertyProfileFields,
  code: propertyCodeSchema,
  timezone: timeZoneSchema,
  currency: currencySchema,
  brandId: propertyProfileFields.brandId.optional(),
  addressLine1: propertyProfileFields.addressLine1.optional(),
  addressLine2: propertyProfileFields.addressLine2.optional(),
  city: propertyProfileFields.city.optional(),
  region: propertyProfileFields.region.optional(),
  postalCode: propertyProfileFields.postalCode.optional(),
  phone: propertyProfileFields.phone.optional(),
  email: propertyProfileFields.email.optional(),
  checkInTime: localTimeSchema.default('14:00'),
  checkOutTime: localTimeSchema.default('12:00'),
  /** First business date; defaults to "today" in the property's time zone. */
  currentBusinessDate: localDateSchema.optional(),
});
export type CreatePropertyRequest = z.infer<typeof createPropertyRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type CreatePropertyRequestInput = z.input<typeof createPropertyRequestSchema>;

/**
 * Timezone and currency are deliberately not editable here: changing them on a property
 * with transactions needs a dedicated, audited migration procedure.
 */
export const updatePropertyRequestSchema = z
  .strictObject({ ...propertyProfileFields, status: z.enum(PROPERTY_STATUSES) })
  .partial();
export type UpdatePropertyRequest = z.infer<typeof updatePropertyRequestSchema>;

// ---- Feature flags ---------------------------------------------------------------------------

/**
 * The platform's feature flags. `@hotel/database` syncs them into `feature_flag_definitions`
 * on every deploy; organizations switch them on or off.
 */
export const FEATURE_FLAGS = [
  { key: 'self_checkin', description: 'Guest self check-in in the guest portal' },
  { key: 'guest_food_ordering', description: 'Guest food and room-service ordering' },
  { key: 'digital_room_key', description: 'Digital room keys through a room access provider' },
  { key: 'multi_currency', description: 'Multi-currency folios and reporting' },
  { key: 'advanced_reports', description: 'Advanced and group-level reports' },
] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number]['key'];
export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = FEATURE_FLAGS.map((flag) => flag.key);

export const featureFlagSchema = z.object({
  key: z.string(),
  description: z.string(),
  enabled: z.boolean(),
});
export type FeatureFlag = z.infer<typeof featureFlagSchema>;

export const setFeatureFlagRequestSchema = z.strictObject({ enabled: z.boolean() });
export type SetFeatureFlagRequest = z.infer<typeof setFeatureFlagRequestSchema>;
