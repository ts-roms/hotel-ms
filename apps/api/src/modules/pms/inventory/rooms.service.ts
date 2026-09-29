import { Injectable } from '@nestjs/common';
import type {
  CreateRoomBlockRequest,
  CreateRoomRequest,
  HOUSEKEEPING_STATUSES,
  Room,
  RoomBlock,
  SetServiceStatusRequest,
  UpdateRoomRequest,
} from '@hotel/contracts';
import { Prisma, type Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { businessDateOf } from '../../../common/business-date.js';
import { fromDbDate, nightsOf, toDbDate } from '../../../common/dates.js';
import { conflictOnDuplicate, withConstraintMapping } from '../../../common/db-errors.js';
import { Problems } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { refreshCapacity, releaseInventory, takeInventory } from './inventory.js';

type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];

/** Rooms, their statuses and out-of-order blocks (Inventory). */
@Injectable()
export class RoomsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private get ctx() {
    return {
      organizationId: this.cls.get('organizationId')!,
      propertyId: this.cls.get('propertyId')!,
      actorId: this.cls.get('identityId') ?? null,
    };
  }

  // ---- Rooms --------------------------------------------------------------------------------

  async listRooms(): Promise<Room[]> {
    return this.db.run(async (tx) => {
      const businessDate = toDbDate(await businessDateOf(tx, this.ctx.propertyId));
      const rows = await tx.room.findMany({
        where: { propertyId: this.ctx.propertyId },
        include: {
          roomType: { select: { code: true } },
          assignments: {
            where: {
              kind: 'BLOCK',
              releasedAt: null,
              startDate: { lte: businessDate },
              endDate: { gt: businessDate },
            },
            select: { id: true },
          },
        },
        orderBy: { number: 'asc' },
      });
      return rows.map((r) => this.toRoomDto(r, r.assignments.length > 0));
    });
  }

  private toRoomDto(
    r: Prisma.RoomGetPayload<{ include: { roomType: { select: { code: true } } } }>,
    blockedToday: boolean,
  ): Room {
    return {
      id: r.id,
      number: r.number,
      roomTypeId: r.roomTypeId,
      roomTypeCode: r.roomType.code,
      floorId: r.floorId,
      housekeepingStatus: r.housekeepingStatus,
      serviceStatus: blockedToday ? 'OUT_OF_ORDER' : r.serviceStatus,
      blockedToday,
      notes: r.notes,
      archived: r.archivedAt !== null,
      version: r.version,
    };
  }

  private async getRoom(roomId: string): Promise<Room> {
    const room = (await this.listRooms()).find((r) => r.id === roomId);
    if (!room) throw Problems.notFound('Room');
    return room;
  }

  async createRoom(input: CreateRoomRequest): Promise<Room> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const created = await conflictOnDuplicate(
      () =>
        this.db.run(async (tx) => {
          await this.requireRoomType(tx, input.roomTypeId);
          if (input.floorId) await this.requireFloor(tx, input.floorId);
          const room = await tx.room.create({
            data: { organizationId, propertyId, ...input, createdBy: actorId, updatedBy: actorId },
          });
          await refreshCapacity(tx, input.roomTypeId, await businessDateOf(tx, propertyId));
          await this.audit.record(tx, {
            action: 'room.created',
            entityType: 'room',
            entityId: room.id,
            propertyId,
            after: { number: input.number, roomTypeId: input.roomTypeId },
          });
          return room;
        }),
      'A room with this number',
    );
    return this.getRoom(created.id);
  }

  /**
   * Creates imported rooms (CSV import, ADR-0030) inside the caller's transaction,
   * skipping numbers that exist by now, then refreshes the sellable capacity of their
   * room types. The caller validated the rows and records the import's audit entry.
   */
  async importInTx(
    tx: Tx,
    propertyId: string,
    rooms: { number: string; roomTypeId: string; notes: string }[],
  ): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;
    const taken = new Set(
      (await tx.room.findMany({ where: { propertyId }, select: { number: true } })).map((r) =>
        r.number.toUpperCase(),
      ),
    );
    const { organizationId, actorId } = this.ctx;
    for (const room of rooms) {
      if (taken.has(room.number.toUpperCase())) {
        skipped++;
        continue;
      }
      await tx.room.create({
        data: {
          organizationId,
          propertyId,
          number: room.number,
          roomTypeId: room.roomTypeId,
          notes: room.notes,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      created++;
    }
    const today = await businessDateOf(tx, propertyId);
    for (const roomTypeId of new Set(rooms.map((r) => r.roomTypeId)))
      await refreshCapacity(tx, roomTypeId, today);
    return { created, skipped };
  }

  /**
   * Moving a room to another type changes sellable capacity of both types from today on;
   * refused if either would be oversold or the room holds future bookings of its old type.
   */
  async updateRoom(
    roomId: string,
    expectedVersion: number,
    input: UpdateRoomRequest,
  ): Promise<Room> {
    const { propertyId, actorId } = this.ctx;
    await withConstraintMapping(() =>
      this.db.run(async (tx) => {
        const before = await tx.room.findFirst({ where: { id: roomId, propertyId } });
        if (!before) throw Problems.notFound('Room');
        if (input.floorId) await this.requireFloor(tx, input.floorId);
        const typeChanged =
          input.roomTypeId !== undefined && input.roomTypeId !== before.roomTypeId;
        if (typeChanged) {
          await this.requireRoomType(tx, input.roomTypeId!);
          await this.assertNoFutureHolds(tx, roomId, 'RESERVATION');
        }
        const updated = await tx.room.updateMany({
          where: { id: roomId, version: expectedVersion },
          data: { ...input, updatedBy: actorId, version: { increment: 1 } },
        });
        if (updated.count === 0) throw Problems.versionConflict();
        if (typeChanged) {
          const today = await businessDateOf(tx, propertyId);
          await refreshCapacity(tx, before.roomTypeId, today);
          await refreshCapacity(tx, input.roomTypeId!, today);
        }
        await this.audit.record(tx, {
          action: 'room.updated',
          entityType: 'room',
          entityId: roomId,
          propertyId,
          before: { roomTypeId: before.roomTypeId, floorId: before.floorId, notes: before.notes },
          after: input,
        });
      }),
    );
    return this.getRoom(roomId);
  }

  async archiveRoom(roomId: string): Promise<Room> {
    const { propertyId, actorId } = this.ctx;
    await withConstraintMapping(() =>
      this.db.run(async (tx) => {
        const room = await tx.room.findFirst({ where: { id: roomId, propertyId } });
        if (!room) throw Problems.notFound('Room');
        if (room.archivedAt) return;
        await this.assertNoFutureHolds(tx, roomId);
        await tx.room.update({
          where: { id: roomId },
          data: { archivedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
        });
        await refreshCapacity(tx, room.roomTypeId, await businessDateOf(tx, propertyId));
        await this.audit.record(tx, {
          action: 'room.archived',
          entityType: 'room',
          entityId: roomId,
          propertyId,
        });
      }),
    );
    return this.getRoom(roomId);
  }

  async setServiceStatus(roomId: string, input: SetServiceStatusRequest): Promise<Room> {
    const { organizationId, propertyId, actorId } = this.ctx;
    await this.db.run(async (tx) => {
      const room = await tx.room.findFirst({ where: { id: roomId, propertyId, archivedAt: null } });
      if (!room) throw Problems.notFound('Room');
      if (room.serviceStatus === input.status) return;
      await tx.room.update({
        where: { id: roomId },
        data: { serviceStatus: input.status, updatedBy: actorId, version: { increment: 1 } },
      });
      await tx.roomStatusEvent.create({
        data: {
          organizationId,
          propertyId,
          roomId,
          dimension: 'SERVICE',
          fromValue: room.serviceStatus,
          toValue: input.status,
          reason: input.reason || null,
          actorId,
        },
      });
      await this.outbox.enqueue(
        tx,
        'RoomStatusChanged',
        { roomId, dimension: 'SERVICE', from: room.serviceStatus, to: input.status },
        { propertyId },
      );
    });
    return this.getRoom(roomId);
  }

  /**
   * Changes a room's housekeeping status with its history row and event, inside the
   * caller's transaction (housekeeping, check-out, night audit). No-op when the status is
   * unchanged. The caller checks the transition is allowed.
   */
  async setHousekeepingStatusInTx(
    tx: Tx,
    input: {
      organizationId: string;
      propertyId: string;
      roomId: string;
      to: HousekeepingStatus;
      reason: string | null;
      actorId: string | null;
    },
  ): Promise<void> {
    const room = await tx.room.findUniqueOrThrow({ where: { id: input.roomId } });
    if (room.housekeepingStatus === input.to) return;
    await tx.room.update({
      where: { id: input.roomId },
      data: { housekeepingStatus: input.to, version: { increment: 1 } },
    });
    await tx.roomStatusEvent.create({
      data: {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        roomId: input.roomId,
        dimension: 'HOUSEKEEPING',
        fromValue: room.housekeepingStatus,
        toValue: input.to,
        reason: input.reason,
        actorId: input.actorId,
      },
    });
    await this.outbox.enqueue(
      tx,
      'RoomStatusChanged',
      {
        roomId: input.roomId,
        dimension: 'HOUSEKEEPING',
        from: room.housekeepingStatus,
        to: input.to,
      },
      { propertyId: input.propertyId },
    );
  }

  // ---- Out-of-order blocks --------------------------------------------------------------

  async listBlocks(roomId: string): Promise<RoomBlock[]> {
    const rows = await this.db.run((tx) =>
      tx.roomAssignment.findMany({
        where: { roomId, propertyId: this.ctx.propertyId, kind: 'BLOCK' },
        orderBy: { startDate: 'desc' },
        take: 100,
      }),
    );
    return rows.map((b) => ({
      id: b.id,
      roomId: b.roomId,
      startDate: fromDbDate(b.startDate),
      endDate: fromDbDate(b.endDate),
      reason: b.reason,
      released: b.releasedAt !== null,
    }));
  }

  /**
   * Out of order: the room is removed from sale for the dates. Takes one unit of
   * inventory per night (fails if already sold out) and holds the physical room (fails if
   * a booking is assigned to it).
   */
  async createBlock(roomId: string, input: CreateRoomBlockRequest): Promise<RoomBlock> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const block = await withConstraintMapping(() =>
      this.db.run(async (tx) => {
        const room = await tx.room.findFirst({
          where: { id: roomId, propertyId, archivedAt: null },
        });
        if (!room) throw Problems.notFound('Room');
        if (input.startDate < (await businessDateOf(tx, propertyId))) {
          throw Problems.validation([
            { path: 'startDate', message: 'Blocks cannot start before the current business date' },
          ]);
        }
        const created = await tx.roomAssignment.create({
          data: {
            organizationId,
            propertyId,
            roomId,
            kind: 'BLOCK',
            startDate: toDbDate(input.startDate),
            endDate: toDbDate(input.endDate),
            reason: input.reason,
            createdBy: actorId,
          },
        });
        await takeInventory(
          tx,
          organizationId,
          propertyId,
          [{ roomTypeId: room.roomTypeId, dates: nightsOf(input.startDate, input.endDate) }],
          'blocked',
        );
        await this.audit.record(tx, {
          action: 'room.blocked',
          entityType: 'room',
          entityId: roomId,
          propertyId,
          after: { blockId: created.id, ...input },
        });
        await this.outbox.enqueue(
          tx,
          'RoomBlocked',
          { roomId, blockId: created.id, startDate: input.startDate, endDate: input.endDate },
          { propertyId },
        );
        return created;
      }),
    );
    return (await this.listBlocks(roomId)).find((b) => b.id === block.id)!;
  }

  async releaseBlock(roomId: string, blockId: string): Promise<void> {
    const { propertyId } = this.ctx;
    await this.db.run(async (tx) => {
      const block = await tx.roomAssignment.findFirst({
        where: { id: blockId, roomId, propertyId, kind: 'BLOCK' },
        include: { room: { select: { roomTypeId: true } } },
      });
      if (!block) throw Problems.notFound('Block');
      if (block.releasedAt) return;
      const today = await businessDateOf(tx, propertyId);
      await tx.roomAssignment.update({ where: { id: blockId }, data: { releasedAt: new Date() } });
      // Past nights stay counted as they happened; only today and later come back to sale.
      const start = fromDbDate(block.startDate) > today ? fromDbDate(block.startDate) : today;
      const nights = nightsOf(start, fromDbDate(block.endDate));
      await releaseInventory(tx, [{ roomTypeId: block.room.roomTypeId, dates: nights }], 'blocked');
      await this.audit.record(tx, {
        action: 'room.unblocked',
        entityType: 'room',
        entityId: roomId,
        propertyId,
        after: { blockId },
      });
      await this.outbox.enqueue(tx, 'RoomUnblocked', { roomId, blockId }, { propertyId });
    });
  }

  // ---- Helpers ------------------------------------------------------------------------

  private async requireRoomType(tx: Tx, roomTypeId: string): Promise<void> {
    const rt = await tx.roomType.findFirst({
      where: { id: roomTypeId, propertyId: this.ctx.propertyId, archivedAt: null },
    });
    if (!rt) throw Problems.validation([{ path: 'roomTypeId', message: 'Unknown room type' }]);
  }

  private async requireFloor(tx: Tx, floorId: string): Promise<void> {
    const floor = await tx.floor.findFirst({
      where: { id: floorId, propertyId: this.ctx.propertyId },
    });
    if (!floor) throw Problems.validation([{ path: 'floorId', message: 'Unknown floor' }]);
  }

  private async assertNoFutureHolds(
    tx: Tx,
    roomId: string,
    kind?: 'RESERVATION' | 'BLOCK',
  ): Promise<void> {
    const today = toDbDate(await businessDateOf(tx, this.ctx.propertyId));
    const holds = await tx.roomAssignment.count({
      where: { roomId, releasedAt: null, endDate: { gt: today }, ...(kind ? { kind } : {}) },
    });
    if (holds > 0) {
      throw Problems.conflict(
        'The room has current or future bookings or blocks. Move or release them first.',
      );
    }
  }
}
