import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AcceptInvitationRequest,
  acceptInvitationRequestSchema,
  type ChangePasswordRequest,
  changePasswordRequestSchema,
  type ForgotPasswordRequest,
  forgotPasswordRequestSchema,
  type InvitationPreview,
  invitationPreviewSchema,
  type InvitationTokenRequest,
  invitationTokenRequestSchema,
  type LoginRequest,
  loginRequestSchema,
  type MfaChallengeRequest,
  mfaChallengeRequestSchema,
  type MfaCodeRequest,
  mfaCodeRequestSchema,
  problemSchema,
  type RecoveryCodes,
  recoveryCodesSchema,
  type ResetPasswordRequest,
  resetPasswordRequestSchema,
  sessionInfoSchema,
  type SessionInfo,
  type SwitchOrganizationRequest,
  switchOrganizationRequestSchema,
  type TotpEnrollment,
  totpEnrollmentSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import type { RequestContext } from '../../common/request-context.js';
import { AllowMfaPending, NoOrganization, Public } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { InvitationsService } from '../access/invitations.service.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

const enrollmentConfirmedSchema = recoveryCodesSchema.extend({ session: sessionInfoSchema });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly passwords: PasswordService,
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private setSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(this.sessions.cookieName, token, this.sessions.cookieOptions());
  }

  private currentSessionInfo(): Promise<SessionInfo> {
    return this.auth.sessionInfo(this.cls.get('sessionOrganizationId') ?? null, {
      mfaPending: !!this.cls.get('mfaEnabled') && !this.cls.get('mfaVerified'),
    });
  }

  // ---- Sign-in ------------------------------------------------------------------------

  @Post('login')
  @Public()
  @HttpCode(200)
  @ZodResponse(
    200,
    sessionInfoSchema,
    'Password accepted. If mfaPending, complete /auth/mfa/challenge.',
  )
  @ZodResponse(401, problemSchema, 'Invalid credentials')
  async login(
    @ZodBody(loginRequestSchema) body: LoginRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionInfo> {
    const { token, info } = await this.auth.login(body.email, body.password);
    this.setSessionCookie(reply, token);
    return info;
  }

  @Post('mfa/challenge')
  @NoOrganization()
  @AllowMfaPending()
  @HttpCode(200)
  @ZodResponse(200, sessionInfoSchema)
  async challenge(
    @ZodBody(mfaChallengeRequestSchema) body: MfaChallengeRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionInfo> {
    const { token } = await this.mfa.challenge(body);
    this.setSessionCookie(reply, token);
    this.cls.set('mfaVerified', true);
    const organizationId = this.cls.get('sessionOrganizationId') ?? null;
    await this.auth.recordLogin(
      this.cls.get('identityId')!,
      this.cls.get('sessionId')!,
      organizationId,
    );
    return this.auth.sessionInfo(organizationId, { mfaPending: false });
  }

  @Post('logout')
  @NoOrganization()
  @AllowMfaPending()
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.auth.logout();
    reply.clearCookie(this.sessions.cookieName, { path: '/' });
  }

  @Get('session')
  @NoOrganization()
  @AllowMfaPending()
  @ZodResponse(200, sessionInfoSchema)
  session(): Promise<SessionInfo> {
    return this.currentSessionInfo();
  }

  @Post('switch-organization')
  @NoOrganization()
  @HttpCode(200)
  @ZodResponse(200, sessionInfoSchema)
  async switchOrganization(
    @ZodBody(switchOrganizationRequestSchema) body: SwitchOrganizationRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionInfo> {
    const { token, info } = await this.auth.switchOrganization(body.organizationId);
    this.setSessionCookie(reply, token);
    return info;
  }

  // ---- MFA management -----------------------------------------------------------------

  @Post('mfa/totp/enrollment')
  @NoOrganization()
  @HttpCode(200)
  @ZodResponse(200, totpEnrollmentSchema, 'Pending factor created; confirm with a code')
  startEnrollment(): Promise<TotpEnrollment> {
    return this.mfa.startEnrollment();
  }

  @Post('mfa/totp/enrollment/confirm')
  @NoOrganization()
  @HttpCode(200)
  @ZodResponse(200, enrollmentConfirmedSchema, 'MFA enabled; other sessions signed out')
  async confirmEnrollment(
    @ZodBody(mfaCodeRequestSchema) body: MfaCodeRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<z.infer<typeof enrollmentConfirmedSchema>> {
    const { token, recoveryCodes } = await this.mfa.confirmEnrollment(body.code);
    this.setSessionCookie(reply, token);
    this.cls.set('mfaEnabled', true);
    this.cls.set('mfaVerified', true);
    return { ...recoveryCodes, session: await this.currentSessionInfo() };
  }

  @Post('mfa/recovery-codes')
  @NoOrganization()
  @HttpCode(200)
  @ZodResponse(200, recoveryCodesSchema, 'Previous recovery codes stop working')
  regenerateRecoveryCodes(
    @ZodBody(mfaCodeRequestSchema) body: MfaCodeRequest,
  ): Promise<RecoveryCodes> {
    return this.mfa.regenerateRecoveryCodes(body.code);
  }

  @Post('mfa/disable')
  @NoOrganization()
  @HttpCode(204)
  async disableMfa(@ZodBody(mfaChallengeRequestSchema) body: MfaChallengeRequest): Promise<void> {
    await this.mfa.disable(body);
  }

  // ---- Passwords ----------------------------------------------------------------------

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  @ZodResponse(202, z.object({}), 'Always accepted; an email is sent if the account exists')
  async forgotPassword(
    @ZodBody(forgotPasswordRequestSchema) body: ForgotPasswordRequest,
  ): Promise<object> {
    await this.passwords.requestReset(body.email);
    return {};
  }

  @Post('password/reset')
  @Public()
  @HttpCode(204)
  async resetPassword(
    @ZodBody(resetPasswordRequestSchema) body: ResetPasswordRequest,
  ): Promise<void> {
    await this.passwords.reset(body.token, body.newPassword);
  }

  @Post('password/change')
  @NoOrganization()
  @HttpCode(204)
  async changePassword(
    @ZodBody(changePasswordRequestSchema) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.passwords.change(body.currentPassword, body.newPassword);
  }

  // ---- Invitations (signed out) -------------------------------------------------------

  @Post('invitations/preview')
  @Public()
  @HttpCode(200)
  @ZodResponse(200, invitationPreviewSchema)
  previewInvitation(
    @ZodBody(invitationTokenRequestSchema) body: InvitationTokenRequest,
  ): Promise<InvitationPreview> {
    return this.invitations.preview(body.token);
  }

  @Post('invitations/accept')
  @Public()
  @HttpCode(204)
  async acceptInvitation(
    @ZodBody(acceptInvitationRequestSchema) body: AcceptInvitationRequest,
  ): Promise<void> {
    await this.invitations.accept(body.token, body.password);
  }
}
