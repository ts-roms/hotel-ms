import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  GUEST_ID_FILE_TYPES,
  type GuestCheckoutRequest,
  guestCheckoutRequestSchema,
  guestHotelInfoSchema,
  guestNotificationSchema,
  guestStaySchema,
  serviceRequestSchema,
  type UploadGuestIdQuery,
  uploadGuestIdQuerySchema,
} from '@hotel/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { GuestRoute } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { GuestIdentityService } from '../pms/guests/guest-identity.service.js';
import { GuestInboxService } from '../notifications/guest-inbox.service.js';
import { GuestInfoService } from './guest-info.service.js';
import { GuestPortalService } from './guest-portal.service.js';
import { ServiceRequestsService } from '../operations/service-requests/service-requests.service.js';

/** Guest portal extras (ADR-0027): ID upload, hotel info, notifications, checkout. */
@ApiTags('guest portal')
@Controller('guest')
@GuestRoute()
export class GuestExtrasController {
  constructor(
    private readonly portal: GuestPortalService,
    private readonly identity: GuestIdentityService,
    private readonly info: GuestInfoService,
    private readonly guestInbox: GuestInboxService,
    private readonly requests: ServiceRequestsService,
  ) {}

  /** The body is the file (JPEG, PNG, WebP or PDF, at most 8 MiB). */
  @Post('identity')
  @GuestRoute({ verified: true })
  @HttpCode(200)
  @ApiConsumes(...GUEST_ID_FILE_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ZodResponse(200, guestStaySchema)
  async uploadId(
    @ZodQuery(uploadGuestIdQuerySchema) query: UploadGuestIdQuery,
    @Req() req: FastifyRequest,
  ) {
    await this.identity.upload(req.headers['content-type'], req.body, query);
    return this.portal.stay();
  }

  @Get('hotel-info')
  @ZodResponse(200, guestHotelInfoSchema)
  hotelInfo() {
    return this.info.hotelInfo();
  }

  @Get('notifications')
  @GuestRoute({ verified: true })
  @ZodResponse(200, z.object({ items: z.array(guestNotificationSchema) }))
  async notifications() {
    return { items: await this.guestInbox.list() };
  }

  @Post('notifications/read')
  @GuestRoute({ verified: true })
  @HttpCode(204)
  async markRead(): Promise<void> {
    await this.guestInbox.markAllRead();
  }

  @Post('checkout-request')
  @GuestRoute({ verified: true })
  @HttpCode(201)
  @ZodResponse(201, serviceRequestSchema)
  requestCheckout(@ZodBody(guestCheckoutRequestSchema) body: GuestCheckoutRequest) {
    return this.requests.guestRequestCheckout(body);
  }
}
