import { Injectable } from '@nestjs/common';
import {
  type GuestServiceRating,
  type GuestServiceRequestCreate,
  SERVICE_ROUTING,
  type ServiceRequest,
  type ServiceRequestListQuery,
  type ServiceRequestUpdate,
  type StaffServiceRequestCreate,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { invalidState, nextNumber } from '../pms/reservations.service.js';

const include = {
  room: { select: { number: true } },
  guest: { select: { firstName: true, lastName: true } },
  assignee: { select: { id: true, identity: { select: { displayName: true } } } },
} satisfies Prisma.ServiceRequestInclude;

type Row = Prisma.ServiceRequestGetPayload<{ include: typeof include }>;

function toDto(r: Row): ServiceRequest {
  return {
    id: r.id,
    requestNo: r.requestNo,
    category: r.category as ServiceRequest['category'],
    department: r.department as ServiceRequest['department'],
    priority: r.priority,
    description: r.description,
    status: r.status,
    roomNumber: r.room?.number ?? null,
    guestName: r.guest ? `${r.guest.firstName} ${r.guest.lastName}` : null,
    assignee: r.assignee
      ? { membershipId: r.assignee.id, displayName: r.assignee.identity.displayName }
      : null,
    createdAt: r.createdAt.toISOString(),
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    rating: r.rating,
    feedback: r.feedback,
    version: r.version,
  };
}

const FINISHED = new Set(['DONE', 'CANCELLED']);
const ACTIVE_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] as const;

/**
 * Guest service requests (spec §26): created by an in-house guest from the portal or by
 * staff on a guest's behalf, routed to a department by category, then acknowledged,
 * worked and closed by staff.
 */
@Injectable()
export class ServiceRequestsService {
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
    };
  }

  private async create(
    tx: Tx,
    data: Omit<
      Prisma.ServiceRequestUncheckedCreateInput,
      'organizationId' | 'propertyId' | 'requestNo' | 'department'
    > & {
      category: keyof typeof SERVICE_ROUTING;
    },
  ): Promise<ServiceRequest> {
    const { organizationId, propertyId } = this.ctx;
    const n = await nextNumber(tx, organizationId, propertyId, 'service_request');
    const row = await tx.serviceRequest.create({
      data: {
        ...data,
        organizationId,
        propertyId,
        requestNo: `SR-${String(n).padStart(6, '0')}`,
        department: SERVICE_ROUTING[data.category],
      },
      include,
    });
    await this.audit.record(tx, {
      action: 'service_request.created',
      entityType: 'service_request',
      entityId: row.id,
      propertyId,
      after: { category: row.category, source: row.source, roomId: row.roomId },
    });
    await this.outbox.enqueue(
      tx,
      'ServiceRequestCreated',
      {
        serviceRequestId: row.id,
        department: row.department,
        source: row.source as 'GUEST' | 'STAFF',
      },
      { propertyId },
    );
    return toDto(row);
  }

  // ---- Staff ------------------------------------------------------------------------------

  async list(query: ServiceRequestListQuery): Promise<ServiceRequest[]> {
    const { propertyId } = this.ctx;
    const rows = await this.db.run((tx) =>
      tx.serviceRequest.findMany({
        where: {
          propertyId,
          status: query.status === 'ACTIVE' ? { in: [...ACTIVE_STATUSES] } : query.status,
          ...(query.department ? { department: query.department } : {}),
        },
        include,
        orderBy: [{ createdAt: 'desc' }],
        take: query.limit,
      }),
    );
    return rows.map(toDto);
  }

  async staffCreate(input: StaffServiceRequestCreate): Promise<ServiceRequest> {
    const { propertyId } = this.ctx;
    return this.db.run(async (tx) => {
      let guestId: string | null = null;
      let reservationRoomId: string | null = null;
      if (input.roomId) {
        const room = await tx.room.findFirst({
          where: { id: input.roomId, propertyId, archivedAt: null },
        });
        if (!room) throw Problems.validation([{ path: 'roomId', message: 'Unknown room' }]);
        // Attach the in-house guest, if any, so the request shows on their stay.
        const stay = await tx.stay.findFirst({
          where: { roomId: room.id, checkedOutAt: null },
          include: { reservationRoom: { select: { id: true, guestId: true } } },
        });
        reservationRoomId = stay?.reservationRoom.id ?? null;
        guestId = stay?.reservationRoom.guestId ?? null;
      }
      return this.create(tx, {
        source: 'STAFF',
        category: input.category,
        priority: input.priority,
        description: input.description,
        roomId: input.roomId,
        reservationRoomId,
        guestId,
        createdBy: this.cls.get('identityId') ?? null,
      });
    });
  }

  async update(
    id: string,
    input: ServiceRequestUpdate,
    expectedVersion: number,
  ): Promise<ServiceRequest> {
    const { propertyId } = this.ctx;
    return this.db.run(async (tx) => {
      const current = await tx.serviceRequest.findFirst({ where: { id, propertyId } });
      if (!current) throw Problems.notFound('Service request');
      if (current.version !== expectedVersion) throw Problems.versionConflict();
      if (FINISHED.has(current.status)) throw invalidState('The request is closed.');
      if (input.assignedMembershipId) await this.requireAssignee(tx, input.assignedMembershipId);

      const now = new Date();
      const data: Prisma.ServiceRequestUncheckedUpdateInput = { version: { increment: 1 } };
      if (input.priority) data.priority = input.priority;
      if (input.assignedMembershipId !== undefined)
        data.assignedMembershipId = input.assignedMembershipId;
      if (input.status) {
        data.status = input.status;
        if (input.status !== 'CANCELLED' && !current.acknowledgedAt) data.acknowledgedAt = now;
        if (input.status === 'DONE') data.completedAt = now;
      }
      // Optimistic concurrency: the version predicate makes a lost update impossible.
      const { count } = await tx.serviceRequest.updateMany({
        where: { id, version: expectedVersion },
        data,
      });
      if (count !== 1) throw Problems.versionConflict();
      const row = await tx.serviceRequest.findUniqueOrThrow({ where: { id }, include });

      await this.audit.record(tx, {
        action: 'service_request.updated',
        entityType: 'service_request',
        entityId: id,
        propertyId,
        before: {
          status: current.status,
          priority: current.priority,
          assignedMembershipId: current.assignedMembershipId,
        },
        after: {
          status: row.status,
          priority: row.priority,
          assignedMembershipId: row.assignedMembershipId,
        },
      });
      await this.outbox.enqueue(
        tx,
        'ServiceRequestUpdated',
        { serviceRequestId: id, status: row.status },
        { propertyId },
      );
      return toDto(row);
    });
  }

  async get(id: string): Promise<ServiceRequest> {
    const { propertyId } = this.ctx;
    const row = await this.db.run((tx) =>
      tx.serviceRequest.findFirst({ where: { id, propertyId }, include }),
    );
    if (!row) throw Problems.notFound('Service request');
    return toDto(row);
  }

  /** Active members who handle guest service at this property (request assignees). */
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

  private assigneeFilter(): Prisma.OrganizationMembershipWhereInput {
    return {
      status: 'ACTIVE',
      roleAssignments: {
        some: {
          OR: [{ scopeType: 'ORGANIZATION' }, { propertyId: this.ctx.propertyId }],
          role: { permissions: { some: { permissionCode: 'guest_service.update' } } },
        },
      },
    };
  }

  private async requireAssignee(tx: Tx, membershipId: string): Promise<void> {
    const ok = await tx.organizationMembership.count({
      where: { id: membershipId, ...this.assigneeFilter() },
    });
    if (!ok) {
      throw Problems.validation([
        {
          path: 'assignedMembershipId',
          message: 'Not an active member handling guest service here',
        },
      ]);
    }
  }

  // ---- Guest ------------------------------------------------------------------------------

  private get guest() {
    return this.cls.get('guest')!;
  }

  async guestList(): Promise<ServiceRequest[]> {
    const rows = await this.db.run((tx) =>
      tx.serviceRequest.findMany({
        where: { reservationRoomId: this.guest.reservationRoomId },
        include,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
    return rows.map(toDto);
  }

  async guestCreate(input: GuestServiceRequestCreate): Promise<ServiceRequest> {
    return this.db.run(async (tx) => {
      const line = await tx.reservationRoom.findUniqueOrThrow({
        where: { id: this.guest.reservationRoomId },
        include: { stays: { where: { checkedOutAt: null }, select: { roomId: true } } },
      });
      const stay = line.stays[0];
      if (line.status !== 'IN_HOUSE' || !stay) {
        throw invalidState('Requests can be made once you are checked in.');
      }
      const open = await tx.serviceRequest.count({
        where: { reservationRoomId: line.id, status: { in: [...ACTIVE_STATUSES] } },
      });
      if (open >= 10)
        throw invalidState('You have 10 open requests; please wait for some to be completed.');
      return this.create(tx, {
        source: 'GUEST',
        category: input.category,
        description: input.description,
        reservationRoomId: line.id,
        roomId: stay.roomId,
        guestId: this.guest.guestId,
      });
    });
  }

  async guestRate(id: string, input: GuestServiceRating): Promise<ServiceRequest> {
    return this.db.run(async (tx) => {
      const current = await tx.serviceRequest.findFirst({
        where: { id, reservationRoomId: this.guest.reservationRoomId },
      });
      if (!current) throw Problems.notFound('Service request');
      if (current.status !== 'DONE') throw invalidState('Only completed requests can be rated.');
      if (current.rating !== null) throw invalidState('This request is already rated.');
      const row = await tx.serviceRequest.update({
        where: { id },
        data: { rating: input.rating, feedback: input.feedback || null, version: { increment: 1 } },
        include,
      });
      await this.audit.record(tx, {
        action: 'service_request.rated',
        entityType: 'service_request',
        entityId: id,
        propertyId: row.propertyId,
        after: { rating: input.rating },
      });
      return toDto(row);
    });
  }
}
