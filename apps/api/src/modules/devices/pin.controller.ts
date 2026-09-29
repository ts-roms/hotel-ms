import { Controller, Delete, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { pinStatusSchema, type SetPinRequest, setPinRequestSchema } from '@hotel/contracts';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { DevicesService } from './devices.service.js';

/** The member's own PIN for shared devices. */
@ApiTags('devices')
@Controller('me/pin')
export class PinController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermission('property.read', 'any')
  @ZodResponse(200, pinStatusSchema)
  status() {
    return this.devices.pinStatus();
  }

  @Put()
  @RequirePermission('property.read', 'any')
  @ZodResponse(200, pinStatusSchema)
  set(@ZodBody(setPinRequestSchema) body: SetPinRequest) {
    return this.devices.setPin(body.pin, body.currentPassword);
  }

  @Delete()
  @RequirePermission('property.read', 'any')
  @ZodResponse(200, pinStatusSchema)
  remove() {
    return this.devices.removePin();
  }
}
