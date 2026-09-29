import { Injectable, Logger } from '@nestjs/common';
import { addDays, toDbDate } from '../../common/dates.js';
import { TenantDb } from '../../infrastructure/database.js';
import { EventRemindersService } from '../calendar/event-reminders.service.js';
import { GuestAccessService } from '../guest-portal/guest-access.service.js';
import { BirthdaysService } from '../hr/workforce/birthdays.service.js';
import { GuestMessagesService } from '../notifications/guest-messages.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

/**
 * Daily reminders for one property (scheduled job after 09:00 local time, ADR-0024). Each
 * context sends its own; this job only calls them:
 * - arrivals tomorrow: an online check-in invitation with a fresh portal link;
 * - departures today: a check-out reminder (GuestMessagesService);
 * - birthdays today: an in-app note to HR at the property (BirthdaysService);
 * - events today: an in-app note to each participant (EventRemindersService, ADR-0026).
 * Every message is reserved in the message log first, so reruns send nothing twice.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly inbox: NotificationsService,
    private readonly guestAccess: GuestAccessService,
    private readonly guestMessages: GuestMessagesService,
    private readonly birthdays: BirthdaysService,
    private readonly eventReminders: EventRemindersService,
  ) {}

  private reserve(key: string, channel: 'EMAIL' | 'IN_APP' = 'EMAIL'): Promise<boolean> {
    return this.db.run((tx) => this.inbox.reserveMessage(tx, key, channel));
  }

  async run(
    propertyId: string,
    localDate: string,
  ): Promise<{ checkIn: number; checkOut: number; birthdays: number; events: number }> {
    let checkIn = 0;

    const arrivals = await this.db.run((tx) =>
      tx.reservation.findMany({
        where: {
          propertyId,
          status: 'CONFIRMED',
          booker: { email: { not: null } },
          rooms: { some: { arrivalDate: toDbDate(addDays(localDate, 1)), status: 'RESERVED' } },
        },
        select: { id: true },
      }),
    );
    for (const r of arrivals) {
      if (!(await this.reserve(`checkin-reminder:${r.id}`))) continue;
      try {
        await this.guestAccess.sendLink(r.id, 'checkin-reminder');
        checkIn++;
      } catch (error) {
        this.logger.error(`Check-in reminder for ${r.id} failed: ${String(error)}`);
      }
    }

    const checkOut = await this.guestMessages.departureReminders(propertyId, localDate);
    const birthdays = await this.birthdays.remindToday(propertyId, localDate);
    const events = await this.eventReminders.remindToday(propertyId, localDate);

    return { checkIn, checkOut, birthdays, events };
  }
}
