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
import * as op from '../generated/operations.js';
import { data, type Transport } from '../http.js';

/** Sign-in, MFA, passwords, invitations and the session. */
export function authClient({ call }: Transport) {
  return {
    auth: {
      login: (body: LoginRequest) => op.AuthController_login<SessionInfo>(call, body).then(data),
      mfaChallenge: (body: MfaChallengeRequest) =>
        op.AuthController_challenge<SessionInfo>(call, body).then(data),
      startTotpEnrollment: () => op.AuthController_startEnrollment<TotpEnrollment>(call).then(data),
      confirmTotpEnrollment: (body: ConfirmEnrollmentRequest) =>
        op
          .AuthController_confirmEnrollment<RecoveryCodes & { session: SessionInfo }>(call, body)
          .then(data),
      regenerateRecoveryCodes: (code: string) =>
        op.AuthController_regenerateRecoveryCodes<RecoveryCodes>(call, { code }).then(data),
      disableMfa: (body: MfaChallengeRequest) =>
        op.AuthController_disableMfa(call, body).then(data),
      forgotPassword: (email: string) =>
        op.AuthController_forgotPassword<object>(call, { email }).then(data),
      resetPassword: (body: ResetPasswordRequest) =>
        op.AuthController_resetPassword(call, body).then(data),
      changePassword: (body: ChangePasswordRequest) =>
        op.AuthController_changePassword(call, body).then(data),
      previewInvitation: (token: string) =>
        op.AuthController_previewInvitation<InvitationPreview>(call, { token }).then(data),
      acceptInvitation: (body: AcceptInvitationRequest) =>
        op.AuthController_acceptInvitation(call, body).then(data),
      logout: () => op.AuthController_logout(call).then(data),
      session: () => op.AuthController_session<SessionInfo>(call).then(data),
      switchOrganization: (organizationId: string) =>
        op.AuthController_switchOrganization<SessionInfo>(call, { organizationId }).then(data),
    },
  };
}
