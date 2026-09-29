import { Module } from '@nestjs/common';
import { GuestInboxController } from './guest-inbox.controller.js';
import { GuestInboxService } from './guest-inbox.service.js';
import { GuestNotificationsController } from './guest-notifications.controller.js';
import { GuestMessagesService } from './guest-messages.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Messaging (blueprint §6.1, §16): staff notification center, guest messages, the guest
 * inbox and the front desk's messages to it.
 */
@Module({
  controllers: [NotificationsController, GuestInboxController, GuestNotificationsController],
  providers: [NotificationsService, GuestMessagesService, GuestInboxService],
  exports: [NotificationsService, GuestMessagesService, GuestInboxService],
})
export class NotificationsModule {}
