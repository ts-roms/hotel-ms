import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  GUEST_ID_FILE_TYPES,
  guestHotelInfoSchema,
  guestStaySchema,
  type UploadGuestIdQuery,
  uploadGuestIdQuerySchema,
} from '@hotel/contracts';
import type { FastifyRequest } from 'fastify';
import { GuestRoute } from '../../common/route-metadata.js';
import { ZodQuery, ZodResponse } from '../../common/zod.js';
import { GuestIdentityService } from '../pms/guests/guest-identity.service.js';
import { GuestInfoService } from './guest-info.service.js';
import { GuestPortalService } from './guest-portal.service.js';

/**
 * Guest portal extras: ID upload (ADR-0027; Guests stores the file, the response is the
 * guest's stay view, which only the portal composes) and hotel info.
 */
@ApiTags('guest portal')
@Controller('guest')
@GuestRoute()
export class GuestExtrasController {
  constructor(
    private readonly portal: GuestPortalService,
    private readonly identity: GuestIdentityService,
    private readonly info: GuestInfoService,
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
}
