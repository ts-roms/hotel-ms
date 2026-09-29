import { Injectable } from '@nestjs/common';
import type { BusinessDayClosing, DayStats, NightAuditPreview } from '@hotel/contracts';
import { Prisma, type Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { addDays, fromDbDate, toDbDate } from '../../common/dates.js';
import { toMinor } from '../../common/money.js';
import { ProblemException } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { FolioService } from '../finance/folio/folio.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { businessDateOf, RoomsService } from '../pms/inventory/rooms.service.js';
import { ReservationsService } from '../pms/reservations/reservations.service.js';
import { frontDeskInclude, toFrontDeskItem } from './front-office.service.js';
import { HousekeepingService } from '../operations/housekeeping/housekeeping.service.js';

const cannotClose = (detail: string) =>
  new ProblemException(409, 'INVALID_STATE', 'Business day cannot close', detail);

/**
 * Night audit (§12.4): closes one property's business day.
 *
 *   1. Refuse while guests due out are still in house.
 *   2. Mark today's unarrived bookings as no-shows and release their inventory.
 *   3. Post tonight's room charge (with taxes) to every in-house folio. Idempotent per
 *      stay and night, so a retried audit never double-charges.
 *   4. Dirty stayover rooms and queue stayover cleaning for tomorrow.
 *   5. Record the day's statistics and advance the business date.
 *
 * All in one transaction under a lock on the property row: it completes entirely or not
 * at all, and two audits of the same property cannot run concurrently.
 */
@Injectable()
export class NightAuditService {
  constructor(
    private readonly db: TenantDb,
    private readonly folios: FolioService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
    private readonly rooms: RoomsService,
    private readonly housekeeping: HousekeepingService,
    private readonly reservations: ReservationsService,
  ) {}

  private get ctx() {
    return {
      organizationId: this.cls.get('organizationId')!,
      propertyId: this.cls.get('propertyId')!,
      actorId: this.cls.get('identityId') ?? null,
    };
  }

  private async lists(tx: Tx, businessDate: string) {
    const { propertyId } = this.ctx;
    const day = toDbDate(businessDate);
    const find = (where: Prisma.ReservationRoomWhereInput) =>
      tx.reservationRoom.findMany({
        where: { propertyId, ...where },
        include: frontDeskInclude,
        orderBy: { createdAt: 'asc' },
      });
    return {
      pendingDepartures: await find({ status: 'IN_HOUSE', departureDate: { lte: day } }),
      noShows: await find({ status: 'RESERVED', arrivalDate: { lte: day } }),
      inHouse: await find({ status: 'IN_HOUSE', departureDate: { gt: day } }),
    };
  }

  async preview(): Promise<NightAuditPreview> {
    return this.db.run(async (tx) => {
      const businessDate = await businessDateOf(tx, this.ctx.propertyId);
      const { pendingDepartures, noShows, inHouse } = await this.lists(tx, businessDate);
      return {
        businessDate,
        pendingDepartures: pendingDepartures.map(toFrontDeskItem),
        expectedNoShows: noShows.map(toFrontDeskItem),
        inHouseCount: inHouse.length,
        canRun: pendingDepartures.length === 0,
      };
    });
  }

  async run(expectedBusinessDate: string): Promise<BusinessDayClosing> {
    const { organizationId, propertyId, actorId } = this.ctx;
    return this.db.run(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM properties WHERE id = ${propertyId}::uuid FOR UPDATE`;
        const property = await tx.property.findUniqueOrThrow({ where: { id: propertyId } });
        const businessDate = fromDbDate(property.currentBusinessDate);
        if (businessDate !== expectedBusinessDate) {
          throw cannotClose(
            `The business date is ${businessDate}; ${expectedBusinessDate} is already closed.`,
          );
        }
        const day = toDbDate(businessDate);
        const { pendingDepartures, noShows, inHouse } = await this.lists(tx, businessDate);
        if (pendingDepartures.length > 0) {
          const numbers = pendingDepartures.map((l) => l.reservation.confirmationNo).join(', ');
          throw cannotClose(
            `Guests due out are still in house: ${numbers}. Check them out or extend their stays.`,
          );
        }

        // 2. No-shows.
        for (const line of noShows) await this.reservations.markNoShowInTx(tx, line);

        // 3. Room charges for tonight. 4. Stayover housekeeping for tomorrow.
        const tomorrow = addDays(businessDate, 1);
        for (const line of inHouse) {
          const night = await tx.reservationNight.findUnique({
            where: { reservationRoomId_stayDate: { reservationRoomId: line.id, stayDate: day } },
          });
          const folio = line.folios[0];
          const room = line.assignments[0]?.room;
          if (night && folio && night.amountMinor > 0n) {
            await this.folios.postInTx(tx, folio.id, {
              department: 'ROOM',
              description: `Room ${room?.number ?? ''} · ${businessDate}`.trim(),
              amountMinor: night.amountMinor,
              sourceKey: `room:${line.id}:${businessDate}`,
              businessDate,
            });
          }
          if (room && fromDbDate(line.departureDate) > tomorrow) {
            await this.rooms.setHousekeepingStatusInTx(tx, {
              organizationId,
              propertyId,
              roomId: room.id,
              to: 'DIRTY',
              reason: 'Stayover',
              actorId,
            });
            await this.housekeeping.ensureTaskInTx(tx, {
              organizationId,
              propertyId,
              roomId: room.id,
              type: 'STAYOVER',
              businessDate: toDbDate(tomorrow),
              actorId,
            });
          }
        }

        // 5. Statistics and closing.
        const stats = await this.statistics(
          tx,
          businessDate,
          property.currency,
          inHouse.length,
          noShows.length,
        );
        await tx.businessDayClosing.create({
          data: {
            organizationId,
            propertyId,
            businessDate: day,
            closedBy: actorId,
            stats: stats as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.property.update({
          where: { id: propertyId },
          data: { currentBusinessDate: toDbDate(tomorrow) },
        });

        await this.audit.record(tx, {
          action: 'night_audit.closed',
          entityType: 'property',
          entityId: propertyId,
          propertyId,
          after: { businessDate, nextBusinessDate: tomorrow, ...stats },
        });
        await this.outbox.enqueue(
          tx,
          'BusinessDateClosed',
          { businessDate, nextBusinessDate: tomorrow },
          { propertyId },
        );
        return {
          businessDate,
          closedAt: new Date().toISOString(),
          stats,
          nextBusinessDate: tomorrow,
        };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  private async statistics(
    tx: Tx,
    businessDate: string,
    currency: string,
    roomsSold: number,
    noShows: number,
  ): Promise<DayStats> {
    const { propertyId } = this.ctx;
    const day = toDbDate(businessDate);
    const activeRooms = await tx.room.count({ where: { propertyId, archivedAt: null } });
    const blocked = await tx.roomAssignment.count({
      where: {
        propertyId,
        kind: 'BLOCK',
        releasedAt: null,
        startDate: { lte: day },
        endDate: { gt: day },
      },
    });
    const roomsAvailable = Math.max(0, activeRooms - blocked);
    const revenue = await tx.folioLine.aggregate({
      where: {
        propertyId,
        businessDate: day,
        department: 'ROOM',
        type: 'CHARGE',
        sourceKey: { startsWith: 'room:' },
      },
      _sum: { amountMinor: true },
    });
    const roomRevenue = revenue._sum.amountMinor ?? 0n;
    const arrivals = await tx.stay.count({
      where: { propertyId, reservationRoom: { arrivalDate: day } },
    });
    const departures = await tx.reservationRoom.count({
      where: { propertyId, status: 'CHECKED_OUT', departureDate: day },
    });
    const rounded = (n: bigint, d: number) =>
      d === 0 ? 0 : toMinor((n * 2n + BigInt(d)) / (2n * BigInt(d)));
    return {
      currency,
      roomsAvailable,
      roomsSold,
      occupancyPct: roomsAvailable === 0 ? 0 : Math.round((roomsSold / roomsAvailable) * 1000) / 10,
      roomRevenueMinor: toMinor(roomRevenue),
      adrMinor: rounded(roomRevenue, roomsSold),
      revparMinor: rounded(roomRevenue, roomsAvailable),
      arrivals,
      departures,
      noShows,
    };
  }

  async closings(): Promise<BusinessDayClosing[]> {
    const rows = await this.db.run((tx) =>
      tx.businessDayClosing.findMany({
        where: { propertyId: this.ctx.propertyId },
        orderBy: { businessDate: 'desc' },
        take: 60,
      }),
    );
    return rows.map((r) => ({
      businessDate: fromDbDate(r.businessDate),
      closedAt: r.closedAt.toISOString(),
      stats: r.stats as unknown as DayStats,
      nextBusinessDate: addDays(fromDbDate(r.businessDate), 1),
    }));
  }
}
