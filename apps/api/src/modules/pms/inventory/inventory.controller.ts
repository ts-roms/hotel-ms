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
  availabilitySchema,
  type AvailabilityQuery,
  availabilityQuerySchema,
  buildingSchema,
  type CreateBuildingRequest,
  createBuildingRequestSchema,
  type CreateRatePlanRequest,
  createRatePlanRequestSchema,
  type CreateRoomBlockRequest,
  createRoomBlockRequestSchema,
  type CreateRoomRequest,
  createRoomRequestSchema,
  type CreateRoomTypeRequest,
  createRoomTypeRequestSchema,
  type QuoteQuery,
  quoteQuerySchema,
  quoteSchema,
  ratePlanSchema,
  roomBlockSchema,
  roomSchema,
  roomTypeSchema,
  type SetRateOverridesRequest,
  setRateOverridesRequestSchema,
  type SetServiceStatusRequest,
  setServiceStatusRequestSchema,
  type UpdateRatePlanRequest,
  updateRatePlanRequestSchema,
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
import { ZodBody, ZodQuery, ZodResponse } from '../../../common/zod.js';
import { RatesService } from '../pricing/rates.service.js';
import { RoomsService } from './rooms.service.js';

/** Property configuration and inventory. Every route is scoped to :propertyId. */
@ApiTags('inventory')
@Controller('properties/:propertyId')
export class InventoryController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly rates: RatesService,
  ) {}

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

  // ---- Rates ----------------------------------------------------------------------------

  @Get('rate-plans')
  @RequirePermission('rate.read')
  @ZodResponse(200, z.array(ratePlanSchema))
  listRatePlans() {
    return this.rates.list();
  }

  @Post('rate-plans')
  @RequirePermission('rate.manage')
  @HttpCode(201)
  @ZodResponse(201, ratePlanSchema)
  createRatePlan(@ZodBody(createRatePlanRequestSchema) body: CreateRatePlanRequest) {
    return this.rates.create(body);
  }

  @Patch('rate-plans/:ratePlanId')
  @RequirePermission('rate.manage')
  @ZodResponse(200, ratePlanSchema)
  async updateRatePlan(
    @Param('ratePlanId') ratePlanId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateRatePlanRequestSchema) body: UpdateRatePlanRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const plan = await this.rates.update(uuidParam(ratePlanId), parseIfMatch(ifMatch), body);
    reply.header('etag', weakEtag(plan.version));
    return plan;
  }

  @Put('rate-plans/:ratePlanId/overrides')
  @RequirePermission('rate.manage')
  @HttpCode(204)
  async setOverrides(
    @Param('ratePlanId') ratePlanId: string,
    @ZodBody(setRateOverridesRequestSchema) body: SetRateOverridesRequest,
  ) {
    await this.rates.setOverrides(uuidParam(ratePlanId), body);
  }

  @Get('quote')
  @RequirePermission('rate.read')
  @ZodResponse(200, quoteSchema, 'Nightly prices for a prospective stay')
  quote(@ZodQuery(quoteQuerySchema) query: QuoteQuery) {
    return this.rates.quote(query);
  }

  @Get('availability')
  @RequirePermission('reservation.read')
  @ZodResponse(200, availabilitySchema)
  availability(@ZodQuery(availabilityQuerySchema) query: AvailabilityQuery) {
    return this.rates.availability(query);
  }
}
