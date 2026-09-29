import { Injectable } from '@nestjs/common';
import { addDays } from '../../common/dates.js';
import { fromLocal, toLocal } from '../../common/zoned-time.js';
import { TenantDb } from '../../infrastructure/database.js';
import { NotificationsService } from '../notifications/notifications.service.js';

/** The daily "events today" note to each participant of a property's events (ADR-0026). */
@Injectable()
export class EventRemindersService {
  constructor(
    private readonly db: TenantDb,
    private readonly inbox: NotificationsService,
  ) {}

  /**
   * One in-app note per scheduled event that touches the property's local day, to its
   * participants. Reserved in the message log per event and day, so a rerun sends nothing
   * twice. Returns how many events were announced.
   */
  async remindToday(propertyId: string, localDate: string): Promise<number> {
    return this.db.run(async (tx) => {
      const { timezone } = await tx.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { timezone: true },
      });
      const rows = await tx.hotelEvent.findMany({
        where: {
          propertyId,
          status: 'SCHEDULED',
          startsAt: { lt: fromLocal(addDays(localDate, 1), '00:00', timezone) },
          endsAt: { gt: fromLocal(localDate, '00:00', timezone) },
          participants: { some: {} },
        },
        include: { participants: { select: { membershipId: true } } },
      });
      let sent = 0;
      for (const e of rows) {
        if (!(await this.inbox.reserveMessage(tx, `event-today:${e.id}:${localDate}`, 'IN_APP')))
          continue;
        const at = e.allDay ? 'All day' : toLocal(e.startsAt, timezone).time;
        await this.inbox.notifyInTx(tx, {
          membershipIds: e.participants.map((p) => p.membershipId),
          propertyId,
          kind: 'EVENTS_TODAY',
          title: `Today: ${e.title}`,
          body: e.location ? `${at} · ${e.location}` : at,
          link: `/p/${propertyId}/calendar`,
        });
        sent++;
      }
      return sent;
    });
  }
}
