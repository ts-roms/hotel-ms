import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  type AnonymizeRequest,
  anonymizeRequestSchema,
  anonymizeResultSchema,
  IMAGE_UPLOAD_TYPES,
  type ImportCommitRequest,
  importCommitRequestSchema,
  importPreviewSchema,
  importResultSchema,
  propertyImageSchema,
  type UpdatePropertyImageRequest,
  updatePropertyImageRequestSchema,
  type UploadImageQuery,
  uploadImageQuerySchema,
} from '@hotel/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uuidParam } from '../../common/params.js';
import { GuestRoute, RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { ImagesService, type OpenImage } from './images.service.js';
import { ImportsService } from './imports.service.js';
import { PrivacyService } from './privacy.service.js';

const items = <T extends z.ZodType>(schema: T) => z.object({ items: z.array(schema) });

/** A data export as a download; never cached. */
async function sendExport(reply: FastifyReply, name: string, data: unknown): Promise<void> {
  await reply
    .header('content-type', 'application/json; charset=utf-8')
    .header('content-disposition', `attachment; filename="${name}.json"`)
    .header('cache-control', 'no-store')
    .send(JSON.stringify(data, null, 2));
}

/** An image, private to whoever may see it; cached until it changes. */
async function sendImage(req: FastifyRequest, reply: FastifyReply, image: OpenImage) {
  const etag = `"${image.etag}"`;
  if (req.headers['if-none-match'] === etag) {
    image.stream.destroy();
    await reply.status(304).send();
    return;
  }
  await reply
    .header('content-type', 'image/webp')
    .header('etag', etag)
    .header('cache-control', 'private, max-age=86400')
    .header('content-security-policy', "sandbox; default-src 'none'")
    .send(image.stream);
}

/** Data requests (ADR-0030): export or anonymize one person's personal data. */
@ApiTags('privacy')
@Controller()
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('guests/:guestId/export')
  @RequirePermission('privacy.manage', 'organization')
  async exportGuest(@Param('guestId') guestId: string, @Res() reply: FastifyReply) {
    const id = uuidParam(guestId);
    await sendExport(reply, `guest-${id}`, await this.privacy.exportGuest(id));
  }

  @Post('guests/:guestId/anonymize')
  @RequirePermission('privacy.manage', 'organization')
  @HttpCode(200)
  @ZodResponse(200, anonymizeResultSchema)
  anonymizeGuest(
    @Param('guestId') guestId: string,
    @ZodBody(anonymizeRequestSchema) body: AnonymizeRequest,
  ) {
    return this.privacy.anonymizeGuest(uuidParam(guestId), body.reason);
  }

  @Get('employees/:employeeId/export')
  @RequirePermission('privacy.manage', 'organization')
  async exportEmployee(@Param('employeeId') employeeId: string, @Res() reply: FastifyReply) {
    const id = uuidParam(employeeId);
    await sendExport(reply, `employee-${id}`, await this.privacy.exportEmployee(id));
  }

  @Post('employees/:employeeId/anonymize')
  @RequirePermission('privacy.manage', 'organization')
  @HttpCode(200)
  @ZodResponse(200, anonymizeResultSchema)
  anonymizeEmployee(
    @Param('employeeId') employeeId: string,
    @ZodBody(anonymizeRequestSchema) body: AnonymizeRequest,
  ) {
    return this.privacy.anonymizeEmployee(uuidParam(employeeId), body.reason);
  }
}

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

/** Hotel photos and menu item photos (ADR-0030). Upload bodies are the image. */
@ApiTags('images')
@Controller('properties/:propertyId')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get('images')
  @RequirePermission('property.read')
  @ZodResponse(200, items(propertyImageSchema))
  async list(@Param('propertyId') propertyId: string) {
    return { items: await this.images.list(propertyId) };
  }

  @Post('images')
  @RequirePermission('property.settings.manage')
  @ApiConsumes(...IMAGE_UPLOAD_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ZodResponse(201, items(propertyImageSchema))
  async upload(
    @Param('propertyId') propertyId: string,
    @ZodQuery(uploadImageQuerySchema) query: UploadImageQuery,
    @Req() req: FastifyRequest,
  ) {
    return {
      items: await this.images.upload(
        propertyId,
        req.headers['content-type'],
        req.body,
        query.caption,
      ),
    };
  }

  @Patch('images/:imageId')
  @RequirePermission('property.settings.manage')
  @ZodResponse(200, items(propertyImageSchema))
  async update(
    @Param('propertyId') propertyId: string,
    @Param('imageId') imageId: string,
    @ZodBody(updatePropertyImageRequestSchema) body: UpdatePropertyImageRequest,
  ) {
    return { items: await this.images.update(propertyId, uuidParam(imageId), body) };
  }

  @Delete('images/:imageId')
  @RequirePermission('property.settings.manage')
  @HttpCode(204)
  async remove(@Param('propertyId') propertyId: string, @Param('imageId') imageId: string) {
    await this.images.remove(propertyId, uuidParam(imageId));
  }

  @Get('images/:imageId/content')
  @RequirePermission('property.read')
  async content(
    @Param('propertyId') propertyId: string,
    @Param('imageId') imageId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await sendImage(
      req,
      reply,
      await this.images.openPropertyImage(propertyId, uuidParam(imageId)),
    );
  }

  @Put('menu-items/:itemId/image')
  @RequirePermission('fnb.menu.manage')
  @ApiConsumes(...IMAGE_UPLOAD_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ZodResponse(200, z.object({ imageVersion: z.string() }))
  setMenuImage(
    @Param('propertyId') propertyId: string,
    @Param('itemId') itemId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.images.setMenuItemImage(
      propertyId,
      uuidParam(itemId),
      req.headers['content-type'],
      req.body,
    );
  }

  @Delete('menu-items/:itemId/image')
  @RequirePermission('fnb.menu.manage')
  @HttpCode(204)
  async removeMenuImage(@Param('propertyId') propertyId: string, @Param('itemId') itemId: string) {
    await this.images.removeMenuItemImage(propertyId, uuidParam(itemId));
  }

  @Get('menu-items/:itemId/image')
  @RequirePermission('property.read')
  async menuImage(
    @Param('propertyId') propertyId: string,
    @Param('itemId') itemId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await sendImage(
      req,
      reply,
      await this.images.openMenuItemImage(propertyId, uuidParam(itemId), false),
    );
  }
}

/** Guests see their own property's photos and menu photos. */
@ApiTags('guest portal')
@Controller('guest')
@GuestRoute()
export class GuestImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get('hotel-images/:imageId')
  async hotelImage(
    @Param('imageId') imageId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await sendImage(
      req,
      reply,
      await this.images.openPropertyImage(this.images.guestPropertyId(), uuidParam(imageId)),
    );
  }

  @Get('menu-items/:itemId/image')
  async menuImage(
    @Param('itemId') itemId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await sendImage(
      req,
      reply,
      await this.images.openMenuItemImage(this.images.guestPropertyId(), uuidParam(itemId), true),
    );
  }
}
