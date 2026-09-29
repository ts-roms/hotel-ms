import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uuidParam } from '../../common/params.js';
import { GuestRoute } from '../../common/route-metadata.js';
import { sendImage } from './image-response.js';
import { ImagesService } from './images.service.js';

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
