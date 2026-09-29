import {
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
  IMAGE_UPLOAD_TYPES,
  propertyImageSchema,
  type UpdatePropertyImageRequest,
  updatePropertyImageRequestSchema,
  type UploadImageQuery,
  uploadImageQuerySchema,
  listOf,
} from '@hotel/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { sendImage } from './image-response.js';
import { ImagesService } from './images.service.js';

/** Hotel photos and menu item photos (ADR-0030). Upload bodies are the image. */
@ApiTags('images')
@Controller('properties/:propertyId')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get('images')
  @RequirePermission('property.read')
  @ZodResponse(200, listOf(propertyImageSchema))
  async list(@Param('propertyId') propertyId: string) {
    return { items: await this.images.list(propertyId) };
  }

  @Post('images')
  @RequirePermission('property.settings.manage')
  @ApiConsumes(...IMAGE_UPLOAD_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ZodResponse(201, listOf(propertyImageSchema))
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
  @ZodResponse(200, listOf(propertyImageSchema))
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
