import { Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type PhotoRetention, photoRetentionSchema } from '@hotel/contracts';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { TimeClockService } from './time-clock.service.js';

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
