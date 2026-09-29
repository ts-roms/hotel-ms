import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { guestNotificationSchema, listOf } from '@hotel/contracts';
import { GuestRoute } from '../../common/route-metadata.js';
import { ZodResponse } from '../../common/zod.js';
import { GuestInboxService } from './guest-inbox.service.js';

/** The guest's own inbox in the guest portal (verified sessions only, ADR-0033). */
@ApiTags('guest portal')
@Controller('guest')
@GuestRoute()
export class GuestNotificationsController {
  constructor(private readonly guestInbox: GuestInboxService) {}

  @Get('notifications')
  @GuestRoute({ verified: true })
  @ZodResponse(200, listOf(guestNotificationSchema))
  async notifications() {
    return { items: await this.guestInbox.list() };
  }

  @Post('notifications/read')
  @GuestRoute({ verified: true })
  @HttpCode(204)
  async markRead(): Promise<void> {
    await this.guestInbox.markAllRead();
  }
}
