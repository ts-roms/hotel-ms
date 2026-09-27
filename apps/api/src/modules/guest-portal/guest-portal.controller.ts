import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
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
  type ServiceRequest,
  type ServiceRequestListQuery,
  serviceRequestListQuerySchema,
  serviceRequestSchema,
  type ServiceRequestUpdate,
  serviceRequestUpdateSchema,
  type StaffServiceRequestCreate,
  staffServiceRequestCreateSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseIfMatch, weakEtag } from '../../common/etag.js';
import { uuidParam } from '../../common/params.js';
import { GuestRoute, RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { GuestPortalService } from './guest-portal.service.js';
import { GuestSessions } from './guest-session.js';
import { ServiceRequestsService } from './service-requests.service.js';

const serviceRequestList = z.object({ items: z.array(serviceRequestSchema) });
const etag = (r: ServiceRequest) => weakEtag(r.version);

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

@ApiTags('guest service')
@Controller('properties/:propertyId')
export class GuestServiceController {
  constructor(
    private readonly portal: GuestPortalService,
    private readonly requests: ServiceRequestsService,
  ) {}

  @Post('reservations/:reservationId/guest-portal-link')
  @RequirePermission('guest_portal.invite')
  @HttpCode(204)
  async sendLink(@Param('reservationId') reservationId: string): Promise<void> {
    await this.portal.sendLink(uuidParam(reservationId));
  }

  @Get('service-requests')
  @RequirePermission('guest_service.read')
  @ZodResponse(200, serviceRequestList)
  async list(@ZodQuery(serviceRequestListQuerySchema) query: ServiceRequestListQuery) {
    return { items: await this.requests.list(query) };
  }

  @Post('service-requests')
  @RequirePermission('guest_service.update')
  @HttpCode(201)
  @ZodResponse(201, serviceRequestSchema)
  async create(
    @ZodBody(staffServiceRequestCreateSchema) body: StaffServiceRequestCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const created = await this.requests.staffCreate(body);
    reply.header('etag', etag(created));
    return created;
  }

  @Get('service-requests/assignees')
  @RequirePermission('guest_service.update')
  @ZodResponse(
    200,
    z.object({ items: z.array(z.object({ membershipId: z.uuid(), displayName: z.string() })) }),
  )
  async assignees() {
    return { items: await this.requests.staff() };
  }

  @Get('service-requests/:requestId')
  @RequirePermission('guest_service.read')
  @ZodResponse(200, serviceRequestSchema)
  async get(
    @Param('requestId') requestId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const request = await this.requests.get(uuidParam(requestId));
    reply.header('etag', etag(request));
    return request;
  }

  @Patch('service-requests/:requestId')
  @RequirePermission('guest_service.update')
  @ZodResponse(200, serviceRequestSchema)
  async update(
    @Param('requestId') requestId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(serviceRequestUpdateSchema) body: ServiceRequestUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const updated = await this.requests.update(uuidParam(requestId), body, parseIfMatch(ifMatch));
    reply.header('etag', etag(updated));
    return updated;
  }
}
