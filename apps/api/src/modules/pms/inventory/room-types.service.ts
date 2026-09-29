import { Injectable } from '@nestjs/common';
import type {
  Building,
  CreateBuildingRequest,
  CreateRoomTypeRequest,
  RoomType,
  UpdateRoomTypeRequest,
} from '@hotel/contracts';
import { ClsService } from 'nestjs-cls';
import { conflictOnDuplicate } from '../../../common/db-errors.js';
import { Problems } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';

/** Buildings with their floors, and room types (Inventory set-up). */
@Injectable()
export class RoomTypesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
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
}
