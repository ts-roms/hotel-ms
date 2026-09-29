import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CloseLostFoundItem,
  closeLostFoundItemSchema,
  type CreateLostFoundItem,
  createLostFoundItemSchema,
  type LostFoundListQuery,
  lostFoundItemSchema,
  lostFoundListQuerySchema,
  listOf,
} from '@hotel/contracts';
import { IfMatch, parseIfMatch } from '../../../common/etag.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../../common/zod.js';
import { LostFoundService } from './lost-found.service.js';

/** Lost & found of a property (spec §31). */
@ApiTags('maintenance')
@Controller('properties/:propertyId/lost-found')
export class LostFoundController {
  constructor(private readonly lostFound: LostFoundService) {}

  @Get()
  @RequirePermission('lost_found.log')
  @ZodResponse(200, listOf(lostFoundItemSchema))
  async list(@ZodQuery(lostFoundListQuerySchema) query: LostFoundListQuery) {
    return { items: await this.lostFound.list(query) };
  }

  @Post()
  @RequirePermission('lost_found.log')
  @ZodResponse(201, lostFoundItemSchema)
  create(@ZodBody(createLostFoundItemSchema) body: CreateLostFoundItem) {
    return this.lostFound.create(body);
  }

  @Post(':itemId/close')
  @RequirePermission('lost_found.manage')
  @HttpCode(200)
  @ZodResponse(200, lostFoundItemSchema)
  close(
    @Param('itemId') itemId: string,
    @IfMatch() ifMatch: string | undefined,
    @ZodBody(closeLostFoundItemSchema) body: CloseLostFoundItem,
  ) {
    return this.lostFound.close(uuidParam(itemId), parseIfMatch(ifMatch), body);
  }
}
