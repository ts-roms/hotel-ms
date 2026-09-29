import { Injectable } from '@nestjs/common';
import type {
  CreateHousekeepingTaskRequest,
  HousekeepingBoard,
  HOUSEKEEPING_TASK_TYPES,
  HousekeepingTask,
  SetHousekeepingStatusRequest,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate, toDbDate } from '../../../common/dates.js';
import { Problems, invalidState } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { businessDateOf } from '../../../common/business-date.js';
import { RoomsService } from '../../pms/inventory/rooms.service.js';

const taskInclude = {
  room: { select: { number: true } },
  assignee: { select: { id: true, identity: { select: { displayName: true } } } },
} satisfies Prisma.HousekeepingTaskInclude;

type TaskRow = Prisma.HousekeepingTaskGetPayload<{ include: typeof taskInclude }>;

function toTaskDto(t: TaskRow): HousekeepingTask {
  return {
    id: t.id,
    roomId: t.roomId,
    roomNumber: t.room.number,
    type: t.type,
    status: t.status,
    businessDate: fromDbDate(t.businessDate),
    assignee: t.assignee
      ? { membershipId: t.assignee.id, displayName: t.assignee.identity.displayName }
      : null,
    notes: t.notes,
    version: t.version,
  };
}

type Status = SetHousekeepingStatusRequest['status'];
type TaskType = (typeof HOUSEKEEPING_TASK_TYPES)[number];

/** Allowed transitions and the permission each needs (blueprint §31). */
const TRANSITIONS: Record<
  Status,
  { from: Status[]; permission: 'housekeeping.update' | 'housekeeping.inspect' }
> = {
  CLEANING: { from: ['DIRTY'], permission: 'housekeeping.update' },
  CLEAN: { from: ['DIRTY', 'CLEANING'], permission: 'housekeeping.update' },
  INSPECTED: { from: ['CLEAN'], permission: 'housekeeping.inspect' },
  DIRTY: { from: ['CLEANING', 'CLEAN', 'INSPECTED'], permission: 'housekeeping.update' },
};

@Injectable()
export class HousekeepingService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly rooms: RoomsService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private get ctx() {
    return {
      organizationId: this.cls.get('organizationId')!,
      propertyId: this.cls.get('propertyId')!,
      membershipId: this.cls.get('membershipId')!,
      actorId: this.cls.get('identityId') ?? null,
    };
  }

  /** Supervisors (housekeeping.assign) see every room; housekeepers only their own tasks. */
  private get fullBoard(): boolean {
    return this.cls.get('grants')!.hasForProperty('housekeeping.assign', this.ctx.propertyId);
  }

  /**
   * The board, or (with roomId) one room's current state regardless of the caller's
   * task filter: used to answer a status change the caller was allowed to make.
   */
  async board(only?: { roomId: string }): Promise<HousekeepingBoard> {
    const { propertyId, membershipId } = this.ctx;
    const fullBoard = this.fullBoard || only !== undefined;
    return this.db.run(async (tx) => {
      const businessDate = await businessDateOf(tx, propertyId);
      const day = toDbDate(businessDate);
      const openTaskFilter: Prisma.HousekeepingTaskWhereInput = {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        ...(fullBoard ? {} : { assignedMembershipId: membershipId }),
      };
      // Flat queries by property, joined here. Prisma's `include` sends the keys of every
      // parent row (two per room, as relations are keyed by organization too), which makes
      // large statements and costs Prisma CPU per room; these stay small at any hotel size
      // and use the property indexes (ADR-0034).
      const rooms = await tx.room.findMany({
        where: {
          propertyId,
          archivedAt: null,
          ...(only ? { id: only.roomId } : {}),
          ...(fullBoard ? {} : { housekeepingTasks: { some: openTaskFilter } }),
        },
        orderBy: { number: 'asc' },
      });
      const oneRoom = only ? { roomId: only.roomId } : {};
      const typeCodes = new Map(
        (
          await tx.roomType.findMany({ where: { propertyId }, select: { id: true, code: true } })
        ).map((t) => [t.id, t.code]),
      );
      const occupiedRooms = new Set(
        (
          await tx.stay.findMany({
            where: { propertyId, checkedOutAt: null, ...oneRoom },
            select: { roomId: true },
          })
        ).map((s) => s.roomId),
      );
      const openTasks = await tx.housekeepingTask.findMany({
        where: { propertyId, ...openTaskFilter, ...oneRoom },
        orderBy: { createdAt: 'asc' },
      });
      const assigneeIds = [
        ...new Set(openTasks.map((t) => t.assignedMembershipId).filter((id) => id !== null)),
      ];
      const assignees = new Map(
        (
          await tx.organizationMembership.findMany({
            where: { id: { in: assigneeIds } },
            select: { id: true, identity: { select: { displayName: true } } },
          })
        ).map((m) => [m.id, m]),
      );
      const roomNumbers = new Map(rooms.map((r) => [r.id, r.number]));
      const firstTask = new Map<string, TaskRow>();
      for (const t of openTasks) {
        if (firstTask.has(t.roomId)) continue;
        firstTask.set(t.roomId, {
          ...t,
          room: { number: roomNumbers.get(t.roomId) ?? '' },
          assignee: t.assignedMembershipId ? (assignees.get(t.assignedMembershipId) ?? null) : null,
        });
      }
      const assignments = await tx.roomAssignment.findMany({
        where: {
          propertyId,
          releasedAt: null,
          startDate: { lte: day },
          endDate: { gte: day },
          ...oneRoom,
        },
      });
      const lineIds = [
        ...new Set(assignments.map((a) => a.reservationRoomId).filter((id) => id !== null)),
      ];
      const linesById = new Map(
        (
          await tx.reservationRoom.findMany({
            where: { id: { in: lineIds } },
            select: { id: true, status: true, arrivalDate: true, departureDate: true },
          })
        ).map((l) => [l.id, l]),
      );
      const assignmentsByRoom = new Map<string, typeof assignments>();
      for (const a of assignments) {
        const list = assignmentsByRoom.get(a.roomId) ?? [];
        list.push(a);
        assignmentsByRoom.set(a.roomId, list);
      }
      return {
        businessDate,
        fullBoard,
        rooms: rooms.map((room) => {
          const roomAssignments = assignmentsByRoom.get(room.id) ?? [];
          const blocked = roomAssignments.some((a) => a.kind === 'BLOCK' && a.endDate > day);
          const lines = roomAssignments
            .map((a) => (a.reservationRoomId ? linesById.get(a.reservationRoomId) : undefined))
            .filter((l) => l !== undefined);
          const task = firstTask.get(room.id);
          return {
            roomId: room.id,
            number: room.number,
            roomTypeCode: typeCodes.get(room.roomTypeId) ?? '',
            housekeepingStatus: room.housekeepingStatus,
            serviceStatus: blocked ? 'OUT_OF_ORDER' : room.serviceStatus,
            occupied: occupiedRooms.has(room.id),
            arrivalToday: lines.some(
              (l) => l.status === 'RESERVED' && fromDbDate(l.arrivalDate) === businessDate,
            ),
            departureToday: lines.some(
              (l) => l.status === 'IN_HOUSE' && fromDbDate(l.departureDate) <= businessDate,
            ),
            openTask: task ? toTaskDto(task) : null,
          };
        }),
      };
    });
  }

  async setStatus(
    roomId: string,
    input: SetHousekeepingStatusRequest,
  ): Promise<HousekeepingBoard['rooms'][number]> {
    const { organizationId, propertyId, membershipId, actorId } = this.ctx;
    const grants = this.cls.get('grants')!;
    await this.db.run(async (tx) => {
      const room = await tx.room.findFirst({ where: { id: roomId, propertyId, archivedAt: null } });
      if (!room) throw Problems.notFound('Room');
      const rule = TRANSITIONS[input.status];
      if (!grants.hasForProperty(rule.permission, propertyId))
        throw Problems.forbidden(`Missing permission ${rule.permission}`);
      if (room.housekeepingStatus === input.status) return;
      if (!rule.from.includes(room.housekeepingStatus)) {
        throw invalidState(
          `A ${room.housekeepingStatus.toLowerCase()} room cannot become ${input.status.toLowerCase()}.`,
        );
      }
      const openTasks = await tx.housekeepingTask.findMany({
        where: { roomId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      });
      // "Own records": without housekeeping.assign you may only work rooms assigned to you.
      if (!this.fullBoard && !openTasks.some((t) => t.assignedMembershipId === membershipId)) {
        throw Problems.forbidden('This room is not assigned to you.');
      }

      await this.rooms.setHousekeepingStatusInTx(tx, {
        organizationId,
        propertyId,
        roomId,
        to: input.status,
        reason: input.reason || null,
        actorId,
      });
      await this.advanceTasks(tx, openTasks, input.status);
      await this.audit.record(tx, {
        action: 'room.housekeeping_status_changed',
        entityType: 'room',
        entityId: roomId,
        propertyId,
        before: { status: room.housekeepingStatus },
        after: { status: input.status, reason: input.reason || null },
      });
    });
    const board = await this.boardForRoom(roomId);
    if (!board) throw Problems.notFound('Room');
    return board;
  }

  // ---- Called by Front Office (check-out, night audit) ----------------------------------

  /**
   * Creates a housekeeping task unless an open one of the same type exists for the room,
   * inside the caller's transaction. Checks first instead of relying on the unique index,
   * because a constraint error would abort the surrounding transaction.
   */
  async ensureTaskInTx(
    tx: Tx,
    input: {
      organizationId: string;
      propertyId: string;
      roomId: string;
      type: TaskType;
      businessDate: Date;
      actorId: string | null;
    },
  ): Promise<void> {
    const open = await tx.housekeepingTask.findFirst({
      where: { roomId: input.roomId, type: input.type, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    });
    if (open) return;
    await tx.housekeepingTask.create({
      data: {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        roomId: input.roomId,
        type: input.type,
        businessDate: input.businessDate,
        createdBy: input.actorId,
      },
    });
  }

  /** Cancels the room's open tasks of one type, inside the caller's transaction. */
  async cancelOpenTasksInTx(tx: Tx, roomId: string, type: TaskType): Promise<void> {
    await tx.housekeepingTask.updateMany({
      where: { roomId, type, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });
  }

  private async advanceTasks(
    tx: Tx,
    tasks: { id: string; type: string }[],
    status: Status,
  ): Promise<void> {
    const now = new Date();
    for (const task of tasks) {
      const isCleaning = task.type !== 'INSPECTION';
      if (status === 'CLEANING' && isCleaning) {
        await tx.housekeepingTask.update({
          where: { id: task.id },
          data: { status: 'IN_PROGRESS', startedAt: now, version: { increment: 1 } },
        });
      } else if ((status === 'CLEAN' && isCleaning) || (status === 'INSPECTED' && !isCleaning)) {
        await tx.housekeepingTask.update({
          where: { id: task.id },
          data: { status: 'DONE', completedAt: now, version: { increment: 1 } },
        });
      }
    }
  }

  private async boardForRoom(roomId: string) {
    return (await this.board({ roomId })).rooms[0] ?? null;
  }

  async createTask(input: CreateHousekeepingTaskRequest): Promise<HousekeepingTask> {
    const { organizationId, propertyId, actorId } = this.ctx;
    return this.db.run(async (tx) => {
      const room = await tx.room.findFirst({
        where: { id: input.roomId, propertyId, archivedAt: null },
      });
      if (!room) throw Problems.validation([{ path: 'roomId', message: 'Unknown room' }]);
      if (input.assignedMembershipId) await this.requireAssignee(tx, input.assignedMembershipId);
      const open = await tx.housekeepingTask.findFirst({
        where: { roomId: input.roomId, type: input.type, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      });
      if (open) throw Problems.conflict('The room already has an open task of this type.');
      const task = await tx.housekeepingTask.create({
        data: {
          organizationId,
          propertyId,
          roomId: input.roomId,
          type: input.type,
          notes: input.notes,
          assignedMembershipId: input.assignedMembershipId,
          businessDate: toDbDate(await businessDateOf(tx, propertyId)),
          createdBy: actorId,
        },
        include: taskInclude,
      });
      await this.audit.record(tx, {
        action: 'housekeeping.task_created',
        entityType: 'housekeeping_task',
        entityId: task.id,
        propertyId,
        after: input,
      });
      return toTaskDto(task);
    });
  }

  async assignTask(taskId: string, assignedMembershipId: string | null): Promise<HousekeepingTask> {
    const { propertyId } = this.ctx;
    return this.db.run(async (tx) => {
      const task = await tx.housekeepingTask.findFirst({ where: { id: taskId, propertyId } });
      if (!task) throw Problems.notFound('Task');
      if (task.status === 'DONE' || task.status === 'CANCELLED')
        throw invalidState('The task is finished.');
      if (assignedMembershipId) await this.requireAssignee(tx, assignedMembershipId);
      const updated = await tx.housekeepingTask.update({
        where: { id: taskId },
        data: { assignedMembershipId, version: { increment: 1 } },
        include: taskInclude,
      });
      await this.audit.record(tx, {
        action: 'housekeeping.task_assigned',
        entityType: 'housekeeping_task',
        entityId: taskId,
        propertyId,
        before: { assignedMembershipId: task.assignedMembershipId },
        after: { assignedMembershipId },
      });
      return toTaskDto(updated);
    });
  }

  /** Active members who can work this property's housekeeping (task assignees). */
  private assigneeFilter(): Prisma.OrganizationMembershipWhereInput {
    return {
      status: 'ACTIVE',
      roleAssignments: {
        some: {
          OR: [{ scopeType: 'ORGANIZATION' }, { propertyId: this.ctx.propertyId }],
          role: { permissions: { some: { permissionCode: 'housekeeping.update' } } },
        },
      },
    };
  }

  async staff(): Promise<{ membershipId: string; displayName: string }[]> {
    const rows = await this.db.run((tx) =>
      tx.organizationMembership.findMany({
        where: this.assigneeFilter(),
        select: { id: true, identity: { select: { displayName: true } } },
      }),
    );
    return rows
      .map((m) => ({ membershipId: m.id, displayName: m.identity.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  private async requireAssignee(tx: Tx, membershipId: string): Promise<void> {
    const membership = await tx.organizationMembership.findFirst({
      where: { id: membershipId, ...this.assigneeFilter() },
    });
    if (!membership) {
      throw Problems.validation([
        { path: 'assignedMembershipId', message: 'Not a housekeeping member of this property' },
      ]);
    }
  }
}
