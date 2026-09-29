import type {
  ConfirmEnrollmentRequest,
  AcceptInvitationRequest,
  ChangePasswordRequest,
  InvitationPreview,
  LoginRequest,
  MfaChallengeRequest,
  RecoveryCodes,
  ResetPasswordRequest,
  SessionInfo,
  TotpEnrollment,
} from '@hotel/contracts';
import type { Transport } from '../http.js';

/** Sign-in, MFA, passwords, invitations and the session. */
export function authClient({ call }: Transport) {
  return {
    auth: {
      login: (body: LoginRequest) =>
        call<SessionInfo>('POST', '/auth/login', body).then((r) => r.data),
      mfaChallenge: (body: MfaChallengeRequest) =>
        call<SessionInfo>('POST', '/auth/mfa/challenge', body).then((r) => r.data),
      startTotpEnrollment: () =>
        call<TotpEnrollment>('POST', '/auth/mfa/totp/enrollment').then((r) => r.data),
      confirmTotpEnrollment: (body: ConfirmEnrollmentRequest) =>
        call<RecoveryCodes & { session: SessionInfo }>(
          'POST',
          '/auth/mfa/totp/enrollment/confirm',
          body,
        ).then((r) => r.data),
      regenerateRecoveryCodes: (code: string) =>
        call<RecoveryCodes>('POST', '/auth/mfa/recovery-codes', { code }).then((r) => r.data),
      disableMfa: (body: MfaChallengeRequest) =>
        call<void>('POST', '/auth/mfa/disable', body).then((r) => r.data),
      forgotPassword: (email: string) =>
        call<object>('POST', '/auth/password/forgot', { email }).then((r) => r.data),
      resetPassword: (body: ResetPasswordRequest) =>
        call<void>('POST', '/auth/password/reset', body).then((r) => r.data),
      changePassword: (body: ChangePasswordRequest) =>
        call<void>('POST', '/auth/password/change', body).then((r) => r.data),
      previewInvitation: (token: string) =>
        call<InvitationPreview>('POST', '/auth/invitations/preview', { token }).then((r) => r.data),
      acceptInvitation: (body: AcceptInvitationRequest) =>
        call<void>('POST', '/auth/invitations/accept', body).then((r) => r.data),
      logout: () => call<void>('POST', '/auth/logout').then((r) => r.data),
      session: () => call<SessionInfo>('GET', '/auth/session').then((r) => r.data),
      switchOrganization: (organizationId: string) =>
        call<SessionInfo>('POST', '/auth/switch-organization', { organizationId }).then(
          (r) => r.data,
        ),
    },
  };
}
