import { z } from 'zod';
import { SCOPE_TYPES } from './permissions.js';

/**
 * Password policy (NIST SP 800-63B): length over composition rules. Breached-password
 * screening is enforced server-side where available.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(256, 'Use at most 256 characters');

export const loginRequestSchema = z.strictObject({
  email: z.email().max(254),
  // Not passwordSchema: existing passwords must still be accepted if the policy tightens.
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
    /** Platform staff with the ops dashboard (ADR-0029); false until MFA is done. */
    platformOperator: z.boolean(),
  }),
  /**
   * Password accepted but the second factor is still outstanding. Until it is completed
   * the session can only reach the MFA challenge, session info and logout.
   */
  mfaPending: z.boolean(),
  memberships: z.array(membershipSummarySchema),
  activeOrganizationId: z.uuid().nullable(),
  grants: z.array(grantSchema),
  csrfToken: z.string(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

// ---- MFA ----------------------------------------------------------------------------------

export const totpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const totpEnrollmentSchema = z.object({
  /** Base32 secret for manual entry. Shown once; never retrievable again. */
  secret: z.string(),
  otpauthUri: z.string(),
});
export type TotpEnrollment = z.infer<typeof totpEnrollmentSchema>;

export const mfaCodeRequestSchema = z.strictObject({ code: totpCodeSchema });
export type MfaCodeRequest = z.infer<typeof mfaCodeRequestSchema>;

/** Turning MFA on needs the password too: a stolen session alone must not claim it. */
export const confirmEnrollmentRequestSchema = z.strictObject({
  code: totpCodeSchema,
  password: z.string().min(1).max(1024),
});
export type ConfirmEnrollmentRequest = z.infer<typeof confirmEnrollmentRequestSchema>;

export const recoveryCodeSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]{5}-?[a-z0-9]{5}$/i, 'Recovery codes look like abcde-12345');

export const mfaChallengeRequestSchema = z.union([
  z.strictObject({ code: totpCodeSchema }),
  z.strictObject({ recoveryCode: recoveryCodeSchema }),
]);
export type MfaChallengeRequest = z.infer<typeof mfaChallengeRequestSchema>;

export const recoveryCodesSchema = z.object({
  /** Shown once. Each works a single time. */
  recoveryCodes: z.array(z.string()),
});
export type RecoveryCodes = z.infer<typeof recoveryCodesSchema>;

// ---- Passwords -----------------------------------------------------------------------------

export const forgotPasswordRequestSchema = z.strictObject({ email: z.email().max(254) });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid or expired link');

export const resetPasswordRequestSchema = z.strictObject({
  token: tokenSchema,
  newPassword: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const changePasswordRequestSchema = z.strictObject({
  currentPassword: z.string().min(1).max(1024),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

// ---- Invitations ---------------------------------------------------------------------------

export const invitationTokenRequestSchema = z.strictObject({ token: tokenSchema });
export type InvitationTokenRequest = z.infer<typeof invitationTokenRequestSchema>;

export const invitationPreviewSchema = z.object({
  organizationName: z.string(),
  email: z.string(),
  /** The invitee has no account yet and must choose a password when accepting. */
  requiresPassword: z.boolean(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export const acceptInvitationRequestSchema = z.strictObject({
  token: tokenSchema,
  password: passwordSchema.optional(),
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;
