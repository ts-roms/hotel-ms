import { Controller, Get, Headers, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type GuestPortalSettings,
  guestPortalSettingsSchema,
  identityDocumentListQuerySchema,
  type IdentityDocumentListQuery,
  identityDocumentSchema,
  type IdentityReview,
  identityReviewSchema,
  type StaffGuestMessage,
  staffGuestMessageSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseIfMatch } from '../../common/etag.js';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { GuestIdentityService } from '../pms/guests/guest-identity.service.js';
import { GuestInboxService } from '../notifications/guest-inbox.service.js';
import { GuestInfoService } from './guest-info.service.js';

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
