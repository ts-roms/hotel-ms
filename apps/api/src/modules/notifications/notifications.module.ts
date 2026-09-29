import { Module } from '@nestjs/common';
import { GuestInboxService } from './guest-inbox.service.js';
import { GuestMessagesService } from './guest-messages.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/** Messaging (blueprint §6.1, §16): staff notification center, guest messages and inbox. */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, GuestMessagesService, GuestInboxService],
  exports: [NotificationsService, GuestMessagesService, GuestInboxService],
})
export class NotificationsModule {}
