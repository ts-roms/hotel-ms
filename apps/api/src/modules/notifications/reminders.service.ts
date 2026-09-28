import { Injectable, Logger } from '@nestjs/common';
import { addDays, fromDbDate, toDbDate } from '../../common/dates.js';
import { fromLocal, toLocal } from '../../common/zoned-time.js';
import { TenantDb } from '../../infrastructure/database.js';
import { NotificationsQueue } from '../../infrastructure/queue.js';
import { GuestPortalService } from '../guest-portal/guest-portal.service.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Daily reminders for one property (scheduled job after 09:00 local time, ADR-0024):
 * - arrivals tomorrow: an online check-in invitation with a fresh portal link;
 * - departures today: a check-out reminder;
 * - birthdays today: an in-app note to HR at the property;
 * - events today: an in-app note to each participant (ADR-0026).
 * Every message is reserved in the message log first, so reruns send nothing twice.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly inbox: NotificationsService,
    private readonly queue: NotificationsQueue,
    private readonly portal: GuestPortalService,
  ) {}

  private reserve(key: string, channel: 'EMAIL' | 'IN_APP' = 'EMAIL'): Promise<boolean> {
    return this.db.run((tx) => this.inbox.reserveMessage(tx, key, channel));
  }

  async run(
    propertyId: string,
    localDate: string,
  ): Promise<{ checkIn: number; checkOut: number; birthdays: number; events: number }> {
    let checkIn = 0;
    let checkOut = 0;

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
        await this.portal.sendLink(r.id, 'checkin-reminder');
        checkIn++;
      } catch (error) {
        this.logger.error(`Check-in reminder for ${r.id} failed: ${String(error)}`);
      }
    }

    const departures = await this.db.run(async (tx) => {
      const property = await tx.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { name: true, checkOutTime: true },
      });
      const lines = await tx.reservationRoom.findMany({
        where: { propertyId, status: 'IN_HOUSE', departureDate: toDbDate(localDate) },
        include: {
          guest: { select: { firstName: true, email: true } },
          reservation: { select: { booker: { select: { email: true } } } },
          assignments: {
            where: { releasedAt: null, kind: 'RESERVATION' },
            include: { room: { select: { number: true } } },
          },
        },
      });
      return { property, lines };
    });
    for (const line of departures.lines) {
      const to = line.guest.email ?? line.reservation.booker.email;
      if (!to || !line.assignments[0]) continue;
      if (!(await this.reserve(`checkout-reminder:${line.id}`))) continue;
      await this.queue.sendEmail({
        template: 'checkout-reminder',
        to,
        data: {
          guestName: line.guest.firstName,
          propertyName: departures.property.name,
          checkOutTime: departures.property.checkOutTime,
          roomNumber: line.assignments[0].room.number,
        },
      });
      checkOut++;
    }

    // Birthdays: employees working here today who share their birthday.
    const monthDay = localDate.slice(5);
    const birthdays = await this.db.run(async (tx) => {
      const employees = await tx.employee.findMany({
        where: {
          status: 'ACTIVE',
          birthDate: { not: null },
          birthdayVisibility: { not: 'HIDDEN' },
          assignments: {
            some: {
              propertyId,
              startDate: { lte: toDbDate(localDate) },
              OR: [{ endDate: null }, { endDate: { gte: toDbDate(localDate) } }],
            },
          },
        },
        select: { firstName: true, lastName: true, preferredName: true, birthDate: true },
      });
      const today = employees.filter((e) => fromDbDate(e.birthDate!).slice(5) === monthDay);
      if (today.length === 0) return 0;
      if (!(await this.inbox.reserveMessage(tx, `birthdays:${propertyId}:${localDate}`, 'IN_APP')))
        return 0;
      await this.inbox.notifyInTx(tx, {
        membershipIds: await this.inbox.membersWith(tx, 'employee.manage', propertyId),
        propertyId,
        kind: 'BIRTHDAYS_TODAY',
        title: `Birthday${today.length === 1 ? '' : 's'} today`,
        body: today.map((e) => `${e.preferredName || e.firstName} ${e.lastName}`).join(', '),
        link: '/hr/employees',
      });
      return today.length;
    });

    // Events today: each participant hears once per event and day.
    const events = await this.db.run(async (tx) => {
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

    return { checkIn, checkOut, birthdays, events };
  }
}
