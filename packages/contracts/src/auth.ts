import { z } from 'zod';
import { SCOPE_TYPES } from './permissions.js';

export const loginRequestSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const switchOrganizationRequestSchema = z.strictObject({
  organizationId: z.uuid(),
});
export type SwitchOrganizationRequest = z.infer<typeof switchOrganizationRequestSchema>;

export const membershipSummarySchema = z.object({
  organizationId: z.uuid(),
  organizationName: z.string(),
});

export const grantSchema = z.object({
  permission: z.string(),
  scopeType: z.enum(SCOPE_TYPES),
  propertyId: z.uuid().nullable(),
});
export type Grant = z.infer<typeof grantSchema>;

export const sessionInfoSchema = z.object({
  identity: z.object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string(),
    mfaEnabled: z.boolean(),
  }),
  memberships: z.array(membershipSummarySchema),
  activeOrganizationId: z.uuid().nullable(),
  grants: z.array(grantSchema),
  csrfToken: z.string(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
