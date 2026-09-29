import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type StaffGuestMessage, staffGuestMessageSchema } from '@hotel/contracts';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody } from '../../common/zod.js';
import { GuestInboxService } from './guest-inbox.service.js';

/** The front desk's messages to a guest's portal inbox (ADR-0027). */
@ApiTags('guest service')
@Controller('properties/:propertyId')
export class GuestInboxController {
  constructor(private readonly guestInbox: GuestInboxService) {}

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
