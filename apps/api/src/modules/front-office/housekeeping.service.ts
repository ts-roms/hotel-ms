import { Injectable } from '@nestjs/common';
import type {
  CreateHousekeepingTaskRequest,
  HousekeepingBoard,
  HousekeepingTask,
  SetHousekeepingStatusRequest,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate, toDbDate } from '../../common/dates.js';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { invalidState } from '../pms/reservations.service.js';
import { businessDateOf } from '../pms/rooms.service.js';
import { recordRoomStatus } from './room-status.js';

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
    private readonly outbox: OutboxService,
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
      const rooms = await tx.room.findMany({
        where: {
          propertyId,
          archivedAt: null,
          ...(only ? { id: only.roomId } : {}),
          ...(fullBoard ? {} : { housekeepingTasks: { some: openTaskFilter } }),
        },
        include: {
          roomType: { select: { code: true } },
          stays: { where: { checkedOutAt: null }, select: { id: true } },
          housekeepingTasks: {
            where: openTaskFilter,
            include: taskInclude,
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
          assignments: {
            where: { releasedAt: null, startDate: { lte: day }, endDate: { gte: day } },
            include: {
              reservationRoom: { select: { status: true, arrivalDate: true, departureDate: true } },
            },
          },
        },
        orderBy: { number: 'asc' },
      });
      return {
        businessDate,
        fullBoard,
        rooms: rooms.map((room) => {
          const blocked = room.assignments.some((a) => a.kind === 'BLOCK' && a.endDate > day);
          const lines = room.assignments.map((a) => a.reservationRoom).filter((l) => l !== null);
          return {
            roomId: room.id,
            number: room.number,
            roomTypeCode: room.roomType.code,
            housekeepingStatus: room.housekeepingStatus,
            serviceStatus: blocked ? 'OUT_OF_ORDER' : room.serviceStatus,
            occupied: room.stays.length > 0,
            arrivalToday: lines.some(
              (l) => l.status === 'RESERVED' && fromDbDate(l.arrivalDate) === businessDate,
            ),
            departureToday: lines.some(
              (l) => l.status === 'IN_HOUSE' && fromDbDate(l.departureDate) <= businessDate,
            ),
            openTask: room.housekeepingTasks[0] ? toTaskDto(room.housekeepingTasks[0]) : null,
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

      await recordRoomStatus(
        tx,
        {
          organizationId,
          propertyId,
          roomId,
          to: input.status,
          reason: input.reason || null,
          actorId,
        },
        this.outbox,
      );
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
