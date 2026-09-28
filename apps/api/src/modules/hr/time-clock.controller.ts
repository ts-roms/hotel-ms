import { Controller, Get, Param, Put, Res } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  CLOCK_PHOTO_TYPES,
  clockPhotoSchema,
  type DateRangeQuery,
  dateRangeQuerySchema,
  type PhotoRetention,
  photoRetentionSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { TimeClockService } from './time-clock.service.js';

/** Managers review time clock selfies (ADR-0022). */
@ApiTags('hr')
@Controller('properties/:propertyId/attendance/photos')
export class ClockPhotosController {
  constructor(private readonly timeClock: TimeClockService) {}

  @Get()
  @RequirePermission('attendance.read')
  @ZodResponse(200, z.object({ items: z.array(clockPhotoSchema) }))
  async list(
    @Param('propertyId') propertyId: string,
    @ZodQuery(dateRangeQuerySchema) query: DateRangeQuery,
  ) {
    return { items: await this.timeClock.photos(propertyId, query.from, query.to) };
  }

  @Get(':punchId')
  @RequirePermission('attendance.read')
  @ApiProduces(...CLOCK_PHOTO_TYPES)
  async photo(
    @Param('propertyId') propertyId: string,
    @Param('punchId') punchId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const photo = await this.timeClock.openPhoto(propertyId, uuidParam(punchId));
    await reply
      .header('content-type', photo.contentType)
      .header('content-length', String(photo.sizeBytes))
      .header('cache-control', 'private, no-store')
      .header('content-security-policy', "sandbox; default-src 'none'")
      .send(photo.stream);
  }
}

/** How long punch selfies are kept in this organization (ADR-0022). */
@ApiTags('hr')
@Controller('attendance-photo-retention')
export class PhotoRetentionController {
  constructor(private readonly timeClock: TimeClockService) {}

  @Get()
  @RequirePermission('attendance.read', 'any')
  @ZodResponse(200, photoRetentionSchema)
  get() {
    return this.timeClock.retention();
  }

  @Put()
  @RequirePermission('attendance.manage', 'organization')
  @ZodResponse(200, photoRetentionSchema)
  set(@ZodBody(photoRetentionSchema) body: PhotoRetention) {
    return this.timeClock.setRetention(body);
  }
}
