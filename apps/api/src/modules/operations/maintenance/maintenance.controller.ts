import { Controller, Get, Headers, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type CreateMaintenanceRequest,
  createMaintenanceRequestSchema,
  MAINTENANCE_PHOTO_TYPES,
  type MaintenanceAction,
  maintenanceActionSchema,
  maintenanceDetailSchema,
  type MaintenanceListQuery,
  maintenanceListQuerySchema,
  maintenanceRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseIfMatch } from '../../../common/etag.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../../common/zod.js';
import { MaintenanceService } from './maintenance.service.js';

const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

/** Maintenance requests of a property (spec §32, ADR-0023). */
@ApiTags('maintenance')
@Controller('properties/:propertyId/maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @RequirePermission('maintenance.read')
  @ZodResponse(200, items(maintenanceRequestSchema))
  async list(@ZodQuery(maintenanceListQuerySchema) query: MaintenanceListQuery) {
    return { items: await this.maintenance.list(query) };
  }

  @Get('technicians')
  @RequirePermission('maintenance.manage')
  @ZodResponse(200, items(z.object({ membershipId: z.uuid(), displayName: z.string() })))
  async technicians() {
    return { items: await this.maintenance.technicians() };
  }

  @Post()
  @RequirePermission('maintenance.report')
  @ZodResponse(201, maintenanceRequestSchema)
  create(@ZodBody(createMaintenanceRequestSchema) body: CreateMaintenanceRequest) {
    return this.maintenance.create(body);
  }

  @Get(':requestId')
  @RequirePermission('maintenance.read')
  @ZodResponse(200, maintenanceDetailSchema)
  detail(@Param('requestId') requestId: string) {
    return this.maintenance.detail(uuidParam(requestId));
  }

  /** Assign, start, hold, complete, cancel, reprioritize or add a note (If-Match). */
  @Post(':requestId/actions')
  @RequirePermission('maintenance.read')
  @HttpCode(200)
  @ZodResponse(200, maintenanceRequestSchema)
  act(
    @Param('requestId') requestId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(maintenanceActionSchema) body: MaintenanceAction,
  ) {
    return this.maintenance.act(uuidParam(requestId), parseIfMatch(ifMatch), body);
  }

  @Post(':requestId/photos')
  @RequirePermission('maintenance.report')
  @ApiConsumes(...MAINTENANCE_PHOTO_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ZodResponse(201, maintenanceDetailSchema)
  addPhoto(@Param('requestId') requestId: string, @Req() req: FastifyRequest) {
    return this.maintenance.addPhoto(uuidParam(requestId), req.headers['content-type'], req.body);
  }

  @Get(':requestId/photos/:photoId')
  @RequirePermission('maintenance.read')
  @ApiProduces(...MAINTENANCE_PHOTO_TYPES)
  async photo(
    @Param('requestId') requestId: string,
    @Param('photoId') photoId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const photo = await this.maintenance.openPhoto(uuidParam(requestId), uuidParam(photoId));
    await reply
      .header('content-type', photo.contentType)
      .header('content-length', String(photo.sizeBytes))
      .header('cache-control', 'private, max-age=300')
      .header('content-security-policy', "sandbox; default-src 'none'")
      .send(photo.stream);
  }
}
