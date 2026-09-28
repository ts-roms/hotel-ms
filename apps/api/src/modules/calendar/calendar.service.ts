import { Injectable } from '@nestjs/common';
import type {
  Calendar,
  CalendarItem,
  CreateEventRequest,
  EventCategory,
  GuestEvent,
  HotelEvent,
  PermissionCode,
  UpdateEventRequest,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { addDays, fromDbDate, toDbDate } from '../../common/dates.js';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { fromLocal, toLocal } from '../../common/zoned-time.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { employeeName, HrAccess } from '../hr/hr-access.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { invalidState } from '../pms/reservations.service.js';

const include = {
  participants: {
    select: {
      membershipId: true,
      membership: { select: { identity: { select: { displayName: true } } } },
    },
  },
} satisfies Prisma.HotelEventInclude;
type EventRow = Prisma.HotelEventGetPayload<{ include: typeof include }>;

const LIMIT = 500;

/**
 * Hotel events and the unified calendar (spec §38–39, ADR-0026). The calendar merges
 * arrivals, departures, shifts, leave, birthdays, events and out-of-order rooms; every
 * kind appears only as far as the viewer's permissions reach (own shifts and leave for
 * self-service users, visible birthdays only, no leave types without leave.read).
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: HrAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly inbox: NotificationsService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private get ctx() {
    return {
      organizationId: this.cls.get('organizationId')!,
      propertyId: this.cls.get('propertyId')!,
      actorId: this.cls.get('identityId') ?? null,
      membershipId: this.cls.get('membershipId') ?? null,
    };
  }

  private can(permission: PermissionCode, propertyId: string): boolean {
    return this.cls.get('grants')!.hasForProperty(permission, propertyId);
  }

  private async toDto(tx: Tx, e: EventRow): Promise<HotelEvent> {
    const organizer = e.organizerId
      ? await tx.identity.findUnique({
          where: { id: e.organizerId },
          select: { displayName: true },
        })
      : null;
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      category: e.category as EventCategory,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      allDay: e.allDay,
      location: e.location,
      guestVisible: e.guestVisible,
      status: e.status as HotelEvent['status'],
      organizerName: organizer?.displayName ?? null,
      participants: e.participants
        .map((p) => ({ membershipId: p.membershipId, name: p.membership.identity.displayName }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      version: e.version,
    };
  }

  /** "2026-10-03 14:00 · Function room", in the property's time zone. */
  private async when(tx: Tx, startsAt: Date, allDay: boolean, location: string): Promise<string> {
    const { timezone } = await tx.property.findUniqueOrThrow({
      where: { id: this.ctx.propertyId },
      select: { timezone: true },
    });
    const local = toLocal(startsAt, timezone);
    const at = allDay ? `${local.date}, all day` : `${local.date} ${local.time}`;
    return location ? `${at} · ${location}` : at;
  }

  /** Participants must be active members who can see this property. */
  private async checkParticipants(tx: Tx, propertyId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const allowed = new Set(await this.inbox.membersWith(tx, 'property.read', propertyId));
    const invalid = unique.filter((id) => !allowed.has(id));
    if (invalid.length)
      throw Problems.validation([
        { path: 'participantMembershipIds', message: 'Not a member at this property' },
      ]);
    return unique;
  }

  // ---- Events -------------------------------------------------------------------------------

  /** Who can be invited: members who can see the property. */
  async people(): Promise<{ membershipId: string; displayName: string }[]> {
    return this.db.run(async (tx) => {
      const ids = await this.inbox.membersWith(tx, 'property.read', this.ctx.propertyId);
      const rows = await tx.organizationMembership.findMany({
        where: { id: { in: ids } },
        select: { id: true, identity: { select: { displayName: true } } },
      });
      return rows
        .map((m) => ({ membershipId: m.id, displayName: m.identity.displayName }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    });
  }

  async event(id: string): Promise<HotelEvent> {
    return this.db.run(async (tx) => this.toDto(tx, await this.requireEvent(tx, id)));
  }

  private async requireEvent(tx: Tx, id: string): Promise<EventRow> {
    const row = await tx.hotelEvent.findFirst({
      where: { id, propertyId: this.ctx.propertyId },
      include,
    });
    if (!row) throw Problems.notFound('Event');
    return row;
  }

  async create(input: CreateEventRequest): Promise<HotelEvent> {
    const { organizationId, propertyId, actorId, membershipId } = this.ctx;
    return this.db.run(async (tx) => {
      const participants = await this.checkParticipants(
        tx,
        propertyId,
        input.participantMembershipIds,
      );
      const created = await tx.hotelEvent.create({
        data: {
          organizationId,
          propertyId,
          title: input.title,
          description: input.description,
          category: input.category,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          allDay: input.allDay,
          location: input.location,
          guestVisible: input.guestVisible,
          organizerId: actorId,
        },
      });
      await tx.eventParticipant.createMany({
        data: participants.map((m) => ({ organizationId, eventId: created.id, membershipId: m })),
      });
      const row = await this.requireEvent(tx, created.id);
      await this.inbox.notifyInTx(tx, {
        membershipIds: participants.filter((m) => m !== membershipId),
        propertyId,
        kind: 'EVENT_INVITED',
        title: `Invited: ${input.title}`,
        body: await this.when(tx, row.startsAt, row.allDay, row.location),
        link: `/p/${propertyId}/calendar`,
      });
      await this.audit.record(tx, {
        action: 'event.created',
        entityType: 'event',
        entityId: row.id,
        propertyId,
        after: { title: input.title, category: input.category, startsAt: input.startsAt },
      });
      await this.outbox.enqueue(tx, 'EventScheduled', { eventId: row.id }, { propertyId });
      return this.toDto(tx, row);
    });
  }

  async update(
    id: string,
    expectedVersion: number,
    input: UpdateEventRequest,
  ): Promise<HotelEvent> {
    const { organizationId, propertyId, membershipId } = this.ctx;
    return this.db.run(async (tx) => {
      const current = await this.requireEvent(tx, id);
      if (current.version !== expectedVersion) throw Problems.versionConflict();
      if (current.status === 'CANCELLED') throw invalidState('The event was cancelled.');
      const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
      if (endsAt <= startsAt)
        throw Problems.validation([{ path: 'endsAt', message: 'The end must be after the start' }]);
      const { participantMembershipIds, ...fields } = input;
      const { count } = await tx.hotelEvent.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...fields,
          ...(input.startsAt ? { startsAt } : {}),
          ...(input.endsAt ? { endsAt } : {}),
          version: { increment: 1 },
        },
      });
      if (count !== 1) throw Problems.versionConflict();

      const before = current.participants.map((p) => p.membershipId);
      let added: string[] = [];
      if (participantMembershipIds) {
        const next = await this.checkParticipants(tx, propertyId, participantMembershipIds);
        added = next.filter((m) => !before.includes(m));
        await tx.eventParticipant.deleteMany({
          where: { eventId: id, membershipId: { notIn: next } },
        });
        await tx.eventParticipant.createMany({
          data: added.map((m) => ({ organizationId, eventId: id, membershipId: m })),
        });
      }
      const title = input.title ?? current.title;
      const cancelled = input.status === 'CANCELLED';
      const moved =
        cancelled ||
        input.startsAt !== undefined ||
        input.endsAt !== undefined ||
        input.location !== undefined;
      if (moved) {
        await this.inbox.notifyInTx(tx, {
          membershipIds: before.filter((m) => m !== membershipId && !added.includes(m)),
          propertyId,
          kind: 'EVENT_CHANGED',
          title: cancelled ? `Cancelled: ${title}` : `Changed: ${title}`,
          body: cancelled
            ? ''
            : await this.when(
                tx,
                startsAt,
                input.allDay ?? current.allDay,
                input.location ?? current.location,
              ),
          link: `/p/${propertyId}/calendar`,
        });
      }
      await this.inbox.notifyInTx(tx, {
        membershipIds: added.filter((m) => m !== membershipId),
        propertyId,
        kind: 'EVENT_INVITED',
        title: `Invited: ${title}`,
        link: `/p/${propertyId}/calendar`,
      });
      await this.audit.record(tx, {
        action: cancelled ? 'event.cancelled' : 'event.updated',
        entityType: 'event',
        entityId: id,
        propertyId,
        before: { title: current.title, startsAt: current.startsAt, status: current.status },
        after: { ...fields, participants: participantMembershipIds },
      });
      if (cancelled)
        await this.outbox.enqueue(tx, 'EventCancelled', { eventId: id }, { propertyId });
      return this.toDto(tx, await this.requireEvent(tx, id));
    });
  }

  /** Guest portal: upcoming guest-visible events at the guest's property (30 days). */
  async guestEvents(): Promise<GuestEvent[]> {
    const now = new Date();
    const rows = await this.db.run((tx) =>
      tx.hotelEvent.findMany({
        where: {
          propertyId: this.cls.get('propertyId')!,
          guestVisible: true,
          status: 'SCHEDULED',
          endsAt: { gte: now },
          startsAt: { lte: new Date(now.getTime() + 30 * 86_400_000) },
        },
        orderBy: { startsAt: 'asc' },
        take: 50,
      }),
    );
    return rows.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      category: e.category as EventCategory,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      allDay: e.allDay,
      location: e.location,
    }));
  }

  // ---- The unified calendar -------------------------------------------------------------------

  async calendar(propertyId: string, from: string, to: string): Promise<Calendar> {
    return this.db.run(async (tx) => {
      const property = await tx.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { timezone: true },
      });
      const tz = property.timezone;
      const start = fromLocal(from, '00:00', tz);
      const end = fromLocal(addDays(to, 1), '00:00', tz);
      const fromDay = toDbDate(from);
      const toDay = toDbDate(to);
      const items: CalendarItem[] = [];
      const allDay = (
        id: string,
        kind: CalendarItem['kind'],
        title: string,
        first: string,
        endExclusive: string,
        link: string | null,
      ) =>
        items.push({
          id,
          kind,
          title,
          start: first,
          end: endExclusive,
          allDay: true,
          link,
          category: null,
        });

      if (this.can('reservation.read', propertyId)) {
        const lines = await tx.reservationRoom.findMany({
          where: {
            propertyId,
            status: { in: ['RESERVED', 'IN_HOUSE', 'CHECKED_OUT'] },
            OR: [
              { arrivalDate: { gte: fromDay, lte: toDay } },
              { departureDate: { gte: fromDay, lte: toDay } },
            ],
          },
          include: {
            guest: { select: { firstName: true, lastName: true } },
            roomType: { select: { code: true } },
          },
          take: LIMIT,
        });
        for (const l of lines) {
          const name = `${l.guest.firstName} ${l.guest.lastName} (${l.roomType.code})`;
          const link = `/p/${propertyId}/reservations/${l.reservationId}`;
          const arrival = fromDbDate(l.arrivalDate);
          const departure = fromDbDate(l.departureDate);
          if (arrival >= from && arrival <= to)
            allDay(
              `arr:${l.id}`,
              'ARRIVAL',
              `Arrival: ${name}`,
              arrival,
              addDays(arrival, 1),
              link,
            );
          if (departure >= from && departure <= to)
            allDay(
              `dep:${l.id}`,
              'DEPARTURE',
              `Departure: ${name}`,
              departure,
              addDays(departure, 1),
              link,
            );
        }
      }

      // Shifts: everyone's with schedule.read, otherwise only one's own.
      const me = await this.access.findMyEmployee(tx);
      const allShifts = this.can('schedule.read', propertyId);
      if (allShifts || (me && this.can('schedule.read.own', propertyId))) {
        const shifts = await tx.shift.findMany({
          where: {
            propertyId,
            status: 'PUBLISHED',
            startsAt: { lt: end },
            endsAt: { gt: start },
            ...(allShifts ? {} : { employeeId: me!.id }),
          },
          include: {
            employee: { select: { firstName: true, lastName: true, preferredName: true } },
            department: { select: { name: true } },
          },
          take: LIMIT,
        });
        for (const s of shifts)
          items.push({
            id: `shift:${s.id}`,
            kind: 'SHIFT',
            title: `${employeeName(s.employee)} · ${s.department.name}`,
            start: s.startsAt.toISOString(),
            end: s.endsAt.toISOString(),
            allDay: false,
            link: allShifts ? `/p/${propertyId}/schedule` : '/me',
            category: null,
          });
      }

      // Leave: approved leave at the property with leave.read (with the type), else one's own.
      const allLeave = this.can('leave.read', propertyId);
      if (allLeave || (me && this.can('leave.request.own', propertyId))) {
        const leave = await tx.leaveRequest.findMany({
          where: {
            propertyId,
            status: 'APPROVED',
            startDate: { lte: toDay },
            endDate: { gte: fromDay },
            ...(allLeave ? {} : { employeeId: me!.id }),
          },
          include: {
            employee: { select: { firstName: true, lastName: true, preferredName: true } },
            leaveType: { select: { name: true } },
          },
          take: LIMIT,
        });
        for (const l of leave)
          allDay(
            `leave:${l.id}`,
            'LEAVE',
            allLeave
              ? `${employeeName(l.employee)}: ${l.leaveType.name}`
              : `On leave: ${l.leaveType.name}`,
            fromDbDate(l.startDate),
            addDays(fromDbDate(l.endDate), 1),
            allLeave ? `/p/${propertyId}/leave` : '/me',
          );
      }

      // Birthdays: only those the employee chose to show.
      if (this.can('birthday.read', propertyId)) {
        const people = await tx.employee.findMany({
          where: {
            status: 'ACTIVE',
            birthDate: { not: null },
            birthdayVisibility: { not: 'HIDDEN' },
            assignments: {
              some: {
                propertyId,
                startDate: { lte: toDay },
                OR: [{ endDate: null }, { endDate: { gte: fromDay } }],
              },
            },
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            birthDate: true,
          },
        });
        for (const p of people) {
          const monthDay = fromDbDate(p.birthDate!).slice(4);
          // The range spans at most two calendar years.
          for (const year of new Set([from.slice(0, 4), to.slice(0, 4)])) {
            const date = `${year}${monthDay}`;
            if (date >= from && date <= to)
              allDay(
                `bday:${p.id}:${year}`,
                'BIRTHDAY',
                `Birthday: ${employeeName(p)}`,
                date,
                addDays(date, 1),
                null,
              );
          }
        }
      }

      if (this.can('event.read', propertyId)) {
        const events = await tx.hotelEvent.findMany({
          where: { propertyId, status: 'SCHEDULED', startsAt: { lt: end }, endsAt: { gt: start } },
          take: LIMIT,
        });
        for (const e of events)
          items.push({
            id: `event:${e.id}`,
            kind: 'EVENT',
            title: e.location ? `${e.title} · ${e.location}` : e.title,
            start: e.allDay ? toLocal(e.startsAt, tz).date : e.startsAt.toISOString(),
            end: e.allDay ? toLocal(e.endsAt, tz).date : e.endsAt.toISOString(),
            allDay: e.allDay,
            link: `/p/${propertyId}/calendar?event=${e.id}`,
            category: e.category as EventCategory,
          });
      }

      if (this.can('room.read', propertyId)) {
        const blocks = await tx.roomAssignment.findMany({
          where: {
            propertyId,
            kind: 'BLOCK',
            releasedAt: null,
            startDate: { lte: toDay },
            endDate: { gt: fromDay },
          },
          include: { room: { select: { number: true } } },
          take: LIMIT,
        });
        for (const b of blocks)
          allDay(
            `ooo:${b.id}`,
            'OUT_OF_ORDER',
            `Room ${b.room.number} out of order${b.reason ? `: ${b.reason}` : ''}`,
            fromDbDate(b.startDate),
            fromDbDate(b.endDate),
            `/p/${propertyId}/rooms`,
          );
      }

      return { timezone: tz, items };
    });
  }
}
