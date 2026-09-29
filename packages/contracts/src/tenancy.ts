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

/**
 * Timezone and currency are deliberately not editable here: changing them on a property
 * with transactions needs a dedicated, audited migration procedure.
 */
export const updatePropertyRequestSchema = z
  .strictObject({ ...propertyProfileFields, status: z.enum(PROPERTY_STATUSES) })
  .partial();
export type UpdatePropertyRequest = z.infer<typeof updatePropertyRequestSchema>;

// ---- Feature flags ---------------------------------------------------------------------------

export const featureFlagSchema = z.object({
  key: z.string(),
  description: z.string(),
  enabled: z.boolean(),
});
export type FeatureFlag = z.infer<typeof featureFlagSchema>;

export const setFeatureFlagRequestSchema = z.strictObject({ enabled: z.boolean() });
export type SetFeatureFlagRequest = z.infer<typeof setFeatureFlagRequestSchema>;
