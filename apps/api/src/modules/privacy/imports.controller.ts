import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  type ImportCommitRequest,
  importCommitRequestSchema,
  importPreviewSchema,
  importResultSchema,
} from '@hotel/contracts';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { ImportsService } from './imports.service.js';

/** CSV import with preview (ADR-0030). The body is the CSV file (text/csv). */
@ApiTags('import')
@Controller('properties/:propertyId/imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post('guests/preview')
  @RequirePermission('guest.update')
  @HttpCode(200)
  @ApiConsumes('text/csv')
  @ZodResponse(200, importPreviewSchema)
  previewGuests(@Param('propertyId') propertyId: string, @Body() body: unknown) {
    return this.imports.preview(propertyId, 'guests', body);
  }

  @Post('guests/commit')
  @RequirePermission('guest.update')
  @HttpCode(200)
  @ZodResponse(200, importResultSchema)
  commitGuests(
    @Param('propertyId') propertyId: string,
    @ZodBody(importCommitRequestSchema) body: ImportCommitRequest,
  ) {
    return this.imports.commit(propertyId, 'guests', body.token);
  }

  @Post('rooms/preview')
  @RequirePermission('room.manage')
  @HttpCode(200)
  @ApiConsumes('text/csv')
  @ZodResponse(200, importPreviewSchema)
  previewRooms(@Param('propertyId') propertyId: string, @Body() body: unknown) {
    return this.imports.preview(propertyId, 'rooms', body);
  }

  @Post('rooms/commit')
  @RequirePermission('room.manage')
  @HttpCode(200)
  @ZodResponse(200, importResultSchema)
  commitRooms(
    @Param('propertyId') propertyId: string,
    @ZodBody(importCommitRequestSchema) body: ImportCommitRequest,
  ) {
    return this.imports.commit(propertyId, 'rooms', body.token);
  }
}
