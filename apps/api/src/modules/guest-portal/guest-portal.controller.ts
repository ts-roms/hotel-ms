import { Controller, Delete, Get, HttpCode, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type GuestExchangeRequest,
  guestBillSchema,
  guestExchangeRequestSchema,
  type GuestOtpVerifyRequest,
  guestOtpVerifyRequestSchema,
  guestStaySchema,
  type PreCheckInRequest,
  preCheckInRequestSchema,
  selfCheckInResultSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { GuestRoute } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { GuestAccessService } from './guest-access.service.js';
import { GuestPortalService } from './guest-portal.service.js';
import { GuestSessions } from './guest-session.js';

/**
 * Guest realm (blueprint §11): authenticated by GuestGuard with the guest cookie. No route
 * takes a reservation id; everything is resolved from the session.
 */
@ApiTags('guest portal')
@Controller('guest')
@GuestRoute()
export class GuestPortalController {
  constructor(
    private readonly portal: GuestPortalService,
    private readonly access: GuestAccessService,
    private readonly sessions: GuestSessions,
  ) {}

  @Post('session')
  @GuestRoute({ session: false })
  @HttpCode(200)
  @ZodResponse(200, guestStaySchema, 'Exchanges a portal link token for a guest session cookie')
  async exchange(
    @ZodBody(guestExchangeRequestSchema) body: GuestExchangeRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { token, expiresAt, stay } = await this.access.exchange(body.token);
    reply.setCookie(this.sessions.cookieName, token, this.sessions.cookieOptions(expiresAt));
    return stay;
  }

  @Delete('session')
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.access.logout();
    reply.clearCookie(this.sessions.cookieName, { path: '/' });
  }

  @Get('stay')
  @ZodResponse(200, guestStaySchema)
  stay() {
    return this.portal.stay();
  }

  @Post('verification')
  @HttpCode(204)
  async requestCode(): Promise<void> {
    await this.access.requestCode();
  }

  @Post('verification/confirm')
  @HttpCode(200)
  @ZodResponse(200, guestStaySchema)
  verifyCode(@ZodBody(guestOtpVerifyRequestSchema) body: GuestOtpVerifyRequest) {
    return this.access.verifyCode(body.code);
  }

  @Put('pre-check-in')
  @GuestRoute({ verified: true })
  @ZodResponse(200, guestStaySchema)
  preCheckIn(@ZodBody(preCheckInRequestSchema) body: PreCheckInRequest) {
    return this.portal.preCheckIn(body);
  }

  @Post('check-in')
  @GuestRoute({ verified: true })
  @HttpCode(200)
  @ZodResponse(200, selfCheckInResultSchema)
  selfCheckIn() {
    return this.portal.selfCheckIn();
  }

  @Get('bill')
  @GuestRoute({ verified: true })
  @ZodResponse(200, guestBillSchema)
  bill() {
    return this.portal.bill();
  }
}
