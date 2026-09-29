import { Injectable } from '@nestjs/common';
import type {
  Building,
  CreateBuildingRequest,
  CreateRoomBlockRequest,
  CreateRoomRequest,
  CreateRoomTypeRequest,
  Room,
  RoomBlock,
  RoomType,
  SetServiceStatusRequest,
  UpdateRoomRequest,
  UpdateRoomTypeRequest,
} from '@hotel/contracts';
import { Prisma, type Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate, nightsOf, toDbDate } from '../../../common/dates.js';
import { withConstraintMapping } from '../../../common/db-errors.js';
import { Problems } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { refreshCapacity, releaseInventory, takeInventory } from './inventory.js';

/** Current business date of the route's property (the only "today" PMS code may use). */
export async function businessDateOf(tx: Tx, propertyId: string): Promise<string> {
  const property = await tx.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: { currentBusinessDate: true },
  });
  return fromDbDate(property.currentBusinessDate);
}

const conflictOnDuplicate = async <T>(fn: () => Promise<T>, what: string): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw Problems.conflict(`${what} already exists at this property.`);
    }
    throw error;
  }
};

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

  // ---- Buildings ------------------------------------------------------------------------

  async listBuildings(): Promise<Building[]> {
    const rows = await this.db.run((tx) =>
      tx.building.findMany({
        where: { propertyId: this.ctx.propertyId, archivedAt: null },
        include: { floors: { orderBy: { level: 'asc' } } },
        orderBy: { code: 'asc' },
      }),
    );
    return rows.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      floors: b.floors.map((f) => ({ id: f.id, level: f.level, name: f.name })),
    }));
  }

  async createBuilding(input: CreateBuildingRequest): Promise<Building> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const building = await conflictOnDuplicate(
      () =>
        this.db.run(async (tx) => {
          const created = await tx.building.create({
            data: {
              organizationId,
              propertyId,
              code: input.code,
              name: input.name,
              createdBy: actorId,
              updatedBy: actorId,
            },
          });
          for (const floor of input.floors) {
            await tx.floor.create({
              data: {
                organizationId,
                propertyId,
                buildingId: created.id,
                level: floor.level,
                name: floor.name,
              },
            });
          }
          await this.audit.record(tx, {
            action: 'building.created',
            entityType: 'building',
            entityId: created.id,
            propertyId,
            after: { code: input.code, name: input.name, floors: input.floors.length },
          });
          return created;
        }),
      'A building with this code',
    );
    return (await this.listBuildings()).find((b) => b.id === building.id)!;
  }

  // ---- Room types -----------------------------------------------------------------------

  async listRoomTypes(): Promise<RoomType[]> {
    const rows = await this.db.run((tx) =>
      tx.roomType.findMany({
        where: { propertyId: this.ctx.propertyId },
        include: { _count: { select: { rooms: { where: { archivedAt: null } } } } },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      }),
    );
    return rows.map((rt) => ({
      id: rt.id,
      code: rt.code,
      name: rt.name,
      description: rt.description,
      baseOccupancy: rt.baseOccupancy,
      maxOccupancy: rt.maxOccupancy,
      sortOrder: rt.sortOrder,
      archived: rt.archivedAt !== null,
      roomCount: rt._count.rooms,
      version: rt.version,
    }));
  }

  async createRoomType(input: CreateRoomTypeRequest): Promise<RoomType> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const created = await conflictOnDuplicate(
      () =>
        this.db.run(async (tx) => {
          const rt = await tx.roomType.create({
            data: { organizationId, propertyId, ...input, createdBy: actorId, updatedBy: actorId },
          });
          await this.audit.record(tx, {
            action: 'room_type.created',
            entityType: 'room_type',
            entityId: rt.id,
            propertyId,
            after: input,
          });
          return rt;
        }),
      'A room type with this code',
    );
    return (await this.listRoomTypes()).find((rt) => rt.id === created.id)!;
  }

  async updateRoomType(
    roomTypeId: string,
    expectedVersion: number,
    input: UpdateRoomTypeRequest,
  ): Promise<RoomType> {
    const { propertyId, actorId } = this.ctx;
    await this.db.run(async (tx) => {
      const before = await tx.roomType.findFirst({ where: { id: roomTypeId, propertyId } });
      if (!before) throw Problems.notFound('Room type');
      const base = input.baseOccupancy ?? before.baseOccupancy;
      const max = input.maxOccupancy ?? before.maxOccupancy;
      if (max < base) {
        throw Problems.validation([
          { path: 'maxOccupancy', message: 'Max occupancy must be at least base occupancy' },
        ]);
      }
      const updated = await tx.roomType.updateMany({
        where: { id: roomTypeId, version: expectedVersion },
        data: { ...input, updatedBy: actorId, version: { increment: 1 } },
      });
      if (updated.count === 0) throw Problems.versionConflict();
      await this.audit.record(tx, {
        action: 'room_type.updated',
        entityType: 'room_type',
        entityId: roomTypeId,
        propertyId,
        before: {
          name: before.name,
          baseOccupancy: before.baseOccupancy,
          maxOccupancy: before.maxOccupancy,
        },
        after: input,
      });
    });
    return (await this.listRoomTypes()).find((rt) => rt.id === roomTypeId)!;
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
