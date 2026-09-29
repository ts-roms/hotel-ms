import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';
import { GuestEventsController } from './guest-events.controller.js';

/** Engagement (blueprint §6.1, §13.5): events and the unified calendar read model. */
@Module({
  imports: [HrModule, NotificationsModule],
  controllers: [CalendarController, GuestEventsController],
  providers: [CalendarService],
})
export class CalendarModule {}
