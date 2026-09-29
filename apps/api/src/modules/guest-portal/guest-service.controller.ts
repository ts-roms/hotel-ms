import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { GuestPortalService } from './guest-portal.service.js';

/** Sends a reservation's guest the link to the guest portal. */
@ApiTags('guest service')
@Controller('properties/:propertyId')
export class GuestServiceController {
  constructor(private readonly portal: GuestPortalService) {}

  @Post('reservations/:reservationId/guest-portal-link')
  @RequirePermission('guest_portal.invite')
  @HttpCode(204)
  async sendLink(@Param('reservationId') reservationId: string): Promise<void> {
    await this.portal.sendLink(uuidParam(reservationId));
  }
}
