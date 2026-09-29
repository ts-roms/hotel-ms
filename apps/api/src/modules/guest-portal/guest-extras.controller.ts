import { Controller, Get, Headers, HttpCode, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  GUEST_ID_FILE_TYPES,
  type GuestCheckoutRequest,
  guestCheckoutRequestSchema,
  guestHotelInfoSchema,
  guestNotificationSchema,
  type GuestPortalSettings,
  guestPortalSettingsSchema,
  guestStaySchema,
  identityDocumentListQuerySchema,
  type IdentityDocumentListQuery,
  identityDocumentSchema,
  type IdentityReview,
  identityReviewSchema,
  serviceRequestSchema,
  type StaffGuestMessage,
  staffGuestMessageSchema,
  type UploadGuestIdQuery,
  uploadGuestIdQuerySchema,
} from '@hotel/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseIfMatch } from '../../common/etag.js';
import { uuidParam } from '../../common/params.js';
import { GuestRoute, RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { GuestIdentityService } from './guest-identity.service.js';
import { GuestInboxService } from '../notifications/guest-inbox.service.js';
import { GuestInfoService } from './guest-info.service.js';
import { GuestPortalService } from './guest-portal.service.js';
import { ServiceRequestsService } from './service-requests.service.js';

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
  @ZodResponse(200, z.object({ items: z.array(guestNotificationSchema) }))
  async notifications() {
    return { items: await this.guestInbox.list() };
  }

  @Post('notifications/read')
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

/** The front desk's side: ID review, portal settings, messages to guests. */
@ApiTags('guest service')
@Controller('properties/:propertyId')
export class GuestAdminController {
  constructor(
    private readonly identity: GuestIdentityService,
    private readonly info: GuestInfoService,
    private readonly guestInbox: GuestInboxService,
  ) {}

  @Get('guest-ids')
  @RequirePermission('guest.identity.review')
  @ZodResponse(200, z.object({ items: z.array(identityDocumentSchema) }))
  async listIds(
    @Param('propertyId') propertyId: string,
    @ZodQuery(identityDocumentListQuerySchema) query: IdentityDocumentListQuery,
  ) {
    return { items: await this.identity.list(propertyId, query) };
  }

  @Get('guest-ids/:documentId/content')
  @RequirePermission('guest.identity.review')
  async idContent(
    @Param('propertyId') propertyId: string,
    @Param('documentId') documentId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.identity.open(propertyId, uuidParam(documentId));
    await reply
      .header('content-type', file.contentType)
      .header('content-length', String(file.sizeBytes))
      .header('content-disposition', 'inline')
      .header('cache-control', 'private, no-store')
      // Never rendered as a page in our origin, whatever the file contains.
      .header('content-security-policy', "sandbox; default-src 'none'")
      .send(file.stream);
  }

  @Post('guest-ids/:documentId/review')
  @RequirePermission('guest.identity.review')
  @HttpCode(200)
  @ZodResponse(200, identityDocumentSchema)
  review(
    @Param('propertyId') propertyId: string,
    @Param('documentId') documentId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(identityReviewSchema) body: IdentityReview,
  ) {
    return this.identity.review(propertyId, uuidParam(documentId), parseIfMatch(ifMatch), body);
  }

  @Get('guest-portal-settings')
  @RequirePermission('property.read')
  @ZodResponse(200, guestPortalSettingsSchema)
  settings(@Param('propertyId') propertyId: string) {
    return this.info.settings(propertyId);
  }

  @Put('guest-portal-settings')
  @RequirePermission('property.settings.manage')
  @ZodResponse(200, guestPortalSettingsSchema)
  updateSettings(
    @Param('propertyId') propertyId: string,
    @ZodBody(guestPortalSettingsSchema) body: GuestPortalSettings,
  ) {
    return this.info.updateSettings(propertyId, body);
  }

  @Post('reservations/:reservationId/rooms/:lineId/guest-message')
  @RequirePermission('guest_portal.invite')
  @HttpCode(204)
  async message(
    @Param('reservationId') reservationId: string,
    @Param('lineId') lineId: string,
    @ZodBody(staffGuestMessageSchema) body: StaffGuestMessage,
  ): Promise<void> {
    await this.guestInbox.staffMessage(uuidParam(reservationId), uuidParam(lineId), body);
  }
}
