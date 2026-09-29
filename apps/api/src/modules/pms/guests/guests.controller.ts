import { Controller, Get, Headers, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CreateGuestRequest,
  createGuestRequestSchema,
  guestSchema,
  type GuestSearchQuery,
  guestSearchQuerySchema,
  type UpdateGuestRequest,
  updateGuestRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseIfMatch, weakEtag } from '../../../common/etag.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../../common/zod.js';
import { GuestsService } from './guests.service.js';

/** Guest profiles are organization-wide; creation is attributed to a property. */
@ApiTags('guests')
@Controller()
export class GuestsController {
  constructor(private readonly guests: GuestsService) {}

  @Get('guests')
  @RequirePermission('guest.read', 'any')
  @ZodResponse(200, z.array(guestSchema))
  search(@ZodQuery(guestSearchQuerySchema) query: GuestSearchQuery) {
    return this.guests.search(query);
  }

  @Get('guests/:guestId')
  @RequirePermission('guest.read', 'any')
  @ZodResponse(200, guestSchema)
  async get(@Param('guestId') guestId: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const guest = await this.guests.get(uuidParam(guestId));
    reply.header('etag', weakEtag(guest.version));
    return guest;
  }

  @Post('properties/:propertyId/guests')
  @RequirePermission('guest.update')
  @HttpCode(201)
  @ZodResponse(201, guestSchema)
  create(@ZodBody(createGuestRequestSchema) body: CreateGuestRequest) {
    return this.guests.create(body);
  }

  @Patch('guests/:guestId')
  @RequirePermission('guest.update', 'any')
  @ZodResponse(200, guestSchema)
  async update(
    @Param('guestId') guestId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateGuestRequestSchema) body: UpdateGuestRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const guest = await this.guests.update(uuidParam(guestId), parseIfMatch(ifMatch), body);
    reply.header('etag', weakEtag(guest.version));
    return guest;
  }
}
