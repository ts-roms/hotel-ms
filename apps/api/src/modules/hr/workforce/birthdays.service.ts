import { Injectable } from '@nestjs/common';
import type { Birthday } from '@hotel/contracts';
import { fromDbDate } from '../../../common/dates.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { activeOn, employeeName, HrAccess } from '../hr-access.js';

/**
 * Colleagues' birthdays (blueprint §13.5): the list HR and colleagues see, and the daily
 * note to HR. Day and month only: the year never leaves HR records.
 */
@Injectable()
export class BirthdaysService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: HrAccess,
    private readonly inbox: NotificationsService,
  ) {}

  /** Colleagues at a property who share their birthday, soonest first. */
  async birthdays(propertyId: string): Promise<Birthday[]> {
    return this.db.run(async (tx) => {
      const property = await this.access.property(tx, propertyId);
      const rows = await tx.employee.findMany({
        where: {
          status: 'ACTIVE',
          birthdayVisibility: 'DAY_MONTH',
          birthDate: { not: null },
          assignments: { some: { propertyId, ...activeOn(property.today) } },
        },
        select: { id: true, firstName: true, lastName: true, preferredName: true, birthDate: true },
      });
      const todayKey = property.today.slice(5);
      return rows
        .map((e) => {
          const md = fromDbDate(e.birthDate!).slice(5);
          return {
            employeeId: e.id,
            name: employeeName(e),
            month: Number(md.slice(0, 2)),
            day: Number(md.slice(3)),
            sortKey: `${md >= todayKey ? 0 : 1}${md}`,
          };
        })
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
        .map(({ sortKey: _, ...b }) => b);
    });
  }

  /**
   * The daily reminder job (ADR-0024): one in-app note to the property's HR about the
   * employees working there whose birthday is today (unless they hid it). Reserved in the
   * message log, so a rerun sends nothing twice. Returns how many birthdays it named.
   */
  async remindToday(propertyId: string, localDate: string): Promise<number> {
    const monthDay = localDate.slice(5);
    return this.db.run(async (tx) => {
      const employees = await tx.employee.findMany({
        where: {
          status: 'ACTIVE',
          birthDate: { not: null },
          birthdayVisibility: { not: 'HIDDEN' },
          assignments: { some: { propertyId, ...activeOn(localDate) } },
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
        body: today.map(employeeName).join(', '),
        link: '/hr/employees',
      });
      return today.length;
    });
  }
}
