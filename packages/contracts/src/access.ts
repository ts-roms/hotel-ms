import { z } from 'zod';
import { PERMISSION_CODES, SCOPE_TYPES, type PermissionCode } from './permissions.js';

export const MEMBERSHIP_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED'] as const;

const permissionCodeSchema = z.enum(PERMISSION_CODES as [PermissionCode, ...PermissionCode[]]);

export const roleAssignmentSchema = z.object({
  id: z.uuid(),
  roleId: z.uuid(),
  roleKey: z.string(),
  roleName: z.string(),
  scopeType: z.enum(SCOPE_TYPES),
  propertyId: z.uuid().nullable(),
});
export type RoleAssignmentDto = z.infer<typeof roleAssignmentSchema>;

export const memberSchema = z.object({
  membershipId: z.uuid(),
  identityId: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  status: z.enum(MEMBERSHIP_STATUSES),
  mfaEnabled: z.boolean(),
  joinedAt: z.iso.datetime().nullable(),
  assignments: z.array(roleAssignmentSchema),
});
export type Member = z.infer<typeof memberSchema>;

/** `propertyId: null` grants the role at organization scope. */
export const assignmentRequestSchema = z.strictObject({
  roleId: z.uuid(),
  propertyId: z.uuid().nullable(),
});
export type AssignmentRequest = z.infer<typeof assignmentRequestSchema>;

export const inviteMemberRequestSchema = z.strictObject({
  email: z.email().max(254),
  displayName: z.string().trim().min(2).max(120),
  assignments: z.array(assignmentRequestSchema).min(1).max(20),
});
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;

export const updateMemberRequestSchema = z.strictObject({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

export const roleSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  templateKey: z.string().nullable(),
  permissions: z.array(z.string()),
  assignmentCount: z.number().int(),
  version: z.number().int(),
});
export type RoleDto = z.infer<typeof roleSchema>;

export const createRoleRequestSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Lowercase letters, digits and _ (2-40 chars)'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(''),
  permissions: z.array(permissionCodeSchema).min(1),
});
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;

export const updateRoleRequestSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500),
    permissions: z.array(permissionCodeSchema).min(1),
  })
  .partial();
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>;

export const permissionInfoSchema = z.object({
  code: z.string(),
  description: z.string(),
  scopes: z.array(z.enum(SCOPE_TYPES)),
  sensitive: z.boolean(),
});
export type PermissionInfo = z.infer<typeof permissionInfoSchema>;
