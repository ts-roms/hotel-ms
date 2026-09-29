import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  buildingSchema,
  type CreateBuildingRequest,
  createBuildingRequestSchema,
  type CreateRoomBlockRequest,
  createRoomBlockRequestSchema,
  type CreateRoomRequest,
  createRoomRequestSchema,
  type CreateRoomTypeRequest,
  createRoomTypeRequestSchema,
  roomBlockSchema,
  roomSchema,
  roomTypeSchema,
  type SetServiceStatusRequest,
  setServiceStatusRequestSchema,
  type UpdateRoomRequest,
  updateRoomRequestSchema,
  type UpdateRoomTypeRequest,
  updateRoomTypeRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseIfMatch, weakEtag } from '../../../common/etag.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { RoomsService } from './rooms.service.js';

/** Property inventory: buildings, room types, rooms and room blocks. */
@ApiTags('inventory')
@Controller('properties/:propertyId')
export class InventoryController {
  constructor(private readonly rooms: RoomsService) {}

  // ---- Buildings ------------------------------------------------------------------------

  @Get('buildings')
  @RequirePermission('room.read')
  @ZodResponse(200, z.array(buildingSchema))
  listBuildings() {
    return this.rooms.listBuildings();
  }

  @Post('buildings')
  @RequirePermission('room.manage')
  @HttpCode(201)
  @ZodResponse(201, buildingSchema)
  createBuilding(@ZodBody(createBuildingRequestSchema) body: CreateBuildingRequest) {
    return this.rooms.createBuilding(body);
  }

  // ---- Room types -----------------------------------------------------------------------

  @Get('room-types')
  @RequirePermission('room.read')
  @ZodResponse(200, z.array(roomTypeSchema))
  listRoomTypes() {
    return this.rooms.listRoomTypes();
  }

  @Post('room-types')
  @RequirePermission('room.manage')
  @HttpCode(201)
  @ZodResponse(201, roomTypeSchema)
  createRoomType(@ZodBody(createRoomTypeRequestSchema) body: CreateRoomTypeRequest) {
    return this.rooms.createRoomType(body);
  }

  @Patch('room-types/:roomTypeId')
  @RequirePermission('room.manage')
  @ZodResponse(200, roomTypeSchema)
  async updateRoomType(
    @Param('roomTypeId') roomTypeId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateRoomTypeRequestSchema) body: UpdateRoomTypeRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const roomType = await this.rooms.updateRoomType(
      uuidParam(roomTypeId),
      parseIfMatch(ifMatch),
      body,
    );
    reply.header('etag', weakEtag(roomType.version));
    return roomType;
  }

  // ---- Rooms ----------------------------------------------------------------------------

  @Get('rooms')
  @RequirePermission('room.read')
  @ZodResponse(200, z.array(roomSchema))
  listRooms() {
    return this.rooms.listRooms();
  }

  @Post('rooms')
  @RequirePermission('room.manage')
  @HttpCode(201)
  @ZodResponse(201, roomSchema)
  createRoom(@ZodBody(createRoomRequestSchema) body: CreateRoomRequest) {
    return this.rooms.createRoom(body);
  }

  @Patch('rooms/:roomId')
  @RequirePermission('room.manage')
  @ZodResponse(200, roomSchema)
  async updateRoom(
    @Param('roomId') roomId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateRoomRequestSchema) body: UpdateRoomRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const room = await this.rooms.updateRoom(uuidParam(roomId), parseIfMatch(ifMatch), body);
    reply.header('etag', weakEtag(room.version));
    return room;
  }

  @Post('rooms/:roomId/archive')
  @RequirePermission('room.manage')
  @HttpCode(200)
  @ZodResponse(200, roomSchema)
  archiveRoom(@Param('roomId') roomId: string) {
    return this.rooms.archiveRoom(uuidParam(roomId));
  }

  @Put('rooms/:roomId/service-status')
  @RequirePermission('room.manage')
  @ZodResponse(200, roomSchema)
  setServiceStatus(
    @Param('roomId') roomId: string,
    @ZodBody(setServiceStatusRequestSchema) body: SetServiceStatusRequest,
  ) {
    return this.rooms.setServiceStatus(uuidParam(roomId), body);
  }

  @Get('rooms/:roomId/blocks')
  @RequirePermission('room.read')
  @ZodResponse(200, z.array(roomBlockSchema))
  listBlocks(@Param('roomId') roomId: string) {
    return this.rooms.listBlocks(uuidParam(roomId));
  }

  @Post('rooms/:roomId/blocks')
  @RequirePermission('room.manage')
  @HttpCode(201)
  @ZodResponse(201, roomBlockSchema, 'Room out of order for the dates')
  createBlock(
    @Param('roomId') roomId: string,
    @ZodBody(createRoomBlockRequestSchema) body: CreateRoomBlockRequest,
  ) {
    return this.rooms.createBlock(uuidParam(roomId), body);
  }

  @Delete('rooms/:roomId/blocks/:blockId')
  @RequirePermission('room.manage')
  @HttpCode(204)
  async releaseBlock(@Param('roomId') roomId: string, @Param('blockId') blockId: string) {
    await this.rooms.releaseBlock(uuidParam(roomId), uuidParam(blockId));
  }
}
