import { Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type GuestPortalSettings,
  guestPortalSettingsSchema,
  type StaffGuestMessage,
  staffGuestMessageSchema,
} from '@hotel/contracts';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { GuestInboxService } from '../notifications/guest-inbox.service.js';
import { GuestInfoService } from './guest-info.service.js';

/** The front desk's side of the guest portal: portal settings, messages to guests. */
@ApiTags('guest service')
@Controller('properties/:propertyId')
export class GuestAdminController {
  constructor(
    private readonly info: GuestInfoService,
    private readonly guestInbox: GuestInboxService,
  ) {}

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

  @Post('reservations/:reservationId/rooms/:lineId/guest-message')
  @RequirePermission('guest_portal.invite')
  @HttpCode(204)
  async message(
    @Param('reservationId') reservationId: string,
    @Param('lineId') lineId: string,
    @ZodBody(staffGuestMessageSchema) body: StaffGuestMessage,
  ): Promise<void> {
    await this.guestInbox.staffMessage(uuidParam(reservationId), uuidParam(lineId), body);
  }
}
