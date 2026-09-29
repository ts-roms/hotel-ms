import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CreateDeviceRequest,
  createDeviceRequestSchema,
  deviceSchema,
  devicePairingSchema,
  listOf,
} from '@hotel/contracts';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { DevicesService } from './devices.service.js';

/** Managers register, pair and revoke a property's shared devices (ADR-0020). */
@ApiTags('devices')
@Controller('properties/:propertyId/devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermission('device.manage')
  @ZodResponse(200, listOf(deviceSchema))
  async list(@Param('propertyId') propertyId: string) {
    return { items: await this.devices.list(propertyId) };
  }

  @Post()
  @RequirePermission('device.manage')
  @ZodResponse(201, devicePairingSchema)
  create(
    @Param('propertyId') propertyId: string,
    @ZodBody(createDeviceRequestSchema) body: CreateDeviceRequest,
  ) {
    return this.devices.create(propertyId, body);
  }

  @Post(':deviceId/pairing')
  @RequirePermission('device.manage')
  @ZodResponse(201, devicePairingSchema)
  repair(@Param('propertyId') propertyId: string, @Param('deviceId') deviceId: string) {
    return this.devices.repair(propertyId, uuidParam(deviceId));
  }

  @Post(':deviceId/revoke')
  @RequirePermission('device.manage')
  @HttpCode(200)
  @ZodResponse(200, deviceSchema)
  revoke(@Param('propertyId') propertyId: string, @Param('deviceId') deviceId: string) {
    return this.devices.revoke(propertyId, uuidParam(deviceId));
  }
}
