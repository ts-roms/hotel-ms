import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type LoginRequest,
  loginRequestSchema,
  problemSchema,
  sessionInfoSchema,
  type SessionInfo,
  type SwitchOrganizationRequest,
  switchOrganizationRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/request-context.js';
import { NoOrganization, Public } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  @ZodResponse(200, sessionInfoSchema, 'Signed in. Session cookie set.')
  @ZodResponse(401, problemSchema, 'Invalid credentials')
  async login(
    @ZodBody(loginRequestSchema) body: LoginRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionInfo> {
    const { token, info } = await this.auth.login(body.email, body.password);
    reply.setCookie(this.sessions.cookieName, token, this.sessions.cookieOptions());
    return info;
  }

  @Post('logout')
  @NoOrganization()
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.auth.logout();
    reply.clearCookie(this.sessions.cookieName, { path: '/' });
  }

  @Get('session')
  @NoOrganization()
  @ZodResponse(200, sessionInfoSchema)
  session(): Promise<SessionInfo> {
    return this.auth.sessionInfo(this.cls.get('sessionOrganizationId') ?? null);
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
    reply.setCookie(this.sessions.cookieName, token, this.sessions.cookieOptions());
    return info;
  }
}
