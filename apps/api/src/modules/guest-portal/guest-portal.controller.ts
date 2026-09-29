import { Controller, Delete, Get, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type GuestExchangeRequest,
  guestBillSchema,
  guestExchangeRequestSchema,
  type GuestOtpVerifyRequest,
  guestOtpVerifyRequestSchema,
  type GuestServiceRating,
  guestServiceRatingSchema,
  type GuestServiceRequestCreate,
  guestServiceRequestCreateSchema,
  guestStaySchema,
  type PreCheckInRequest,
  preCheckInRequestSchema,
  selfCheckInResultSchema,
  serviceRequestSchema,
  listOf,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { uuidParam } from '../../common/params.js';
import { GuestRoute } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { GuestPortalService } from './guest-portal.service.js';
import { GuestSessions } from './guest-session.js';
import { ServiceRequestsService } from '../operations/service-requests/service-requests.service.js';

const serviceRequestList = listOf(serviceRequestSchema);

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
    private readonly requests: ServiceRequestsService,
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
    const { token, expiresAt, stay } = await this.portal.exchange(body.token);
    reply.setCookie(this.sessions.cookieName, token, this.sessions.cookieOptions(expiresAt));
    return stay;
  }

  @Delete('session')
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.portal.logout();
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
    await this.portal.requestCode();
  }

  @Post('verification/confirm')
  @HttpCode(200)
  @ZodResponse(200, guestStaySchema)
  verifyCode(@ZodBody(guestOtpVerifyRequestSchema) body: GuestOtpVerifyRequest) {
    return this.portal.verifyCode(body.code);
  }

  @Put('pre-check-in')
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

  @Get('service-requests')
  @GuestRoute({ verified: true })
  @ZodResponse(200, serviceRequestList)
  async listRequests() {
    return { items: await this.requests.guestList() };
  }

  @Post('service-requests')
  @GuestRoute({ verified: true })
  @HttpCode(201)
  @ZodResponse(201, serviceRequestSchema)
  createRequest(@ZodBody(guestServiceRequestCreateSchema) body: GuestServiceRequestCreate) {
    return this.requests.guestCreate(body);
  }

  @Put('service-requests/:requestId/rating')
  @GuestRoute({ verified: true })
  @ZodResponse(200, serviceRequestSchema)
  rate(
    @Param('requestId') requestId: string,
    @ZodBody(guestServiceRatingSchema) body: GuestServiceRating,
  ) {
    return this.requests.guestRate(uuidParam(requestId), body);
  }
}
