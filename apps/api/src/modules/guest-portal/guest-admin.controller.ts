import { Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type GuestPortalSettings, guestPortalSettingsSchema } from '@hotel/contracts';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { GuestInfoService } from './guest-info.service.js';

/** The front desk's side of the guest portal: portal settings. */
@ApiTags('guest service')
@Controller('properties/:propertyId')
export class GuestAdminController {
  constructor(private readonly info: GuestInfoService) {}

  @Get('guest-portal-settings')
  @RequirePermission('property.read')
  @ZodResponse(200, guestPortalSettingsSchema)
  settings(@Param('propertyId') propertyId: string) {
    return this.info.settings(propertyId);
  }

  @Put('guest-portal-settings')
  @RequirePermission('property.settings.manage')
  @ZodResponse(200, guestPortalSettingsSchema)
  updateSettings(
    @Param('propertyId') propertyId: string,
    @ZodBody(guestPortalSettingsSchema) body: GuestPortalSettings,
  ) {
    return this.info.updateSettings(propertyId, body);
  }
}
