import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateMaintenanceRequest,
  MAINTENANCE_PHOTO_MAX_BYTES,
  MAINTENANCE_PHOTO_TYPES,
  type MaintenanceAction,
  type MaintenanceDetail,
  type MaintenanceListQuery,
  type MaintenanceRequest,
  type MaintenanceStatus,
  type PermissionCode,
} from '@hotel/contracts';
import { type Prisma, type Tx, uuidv7 } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate } from '../../common/dates.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import {
  OBJECT_STORAGE,
  ObjectNotFound,
  type ObjectStorage,
} from '../../infrastructure/storage.js';
import { AuditService } from '../audit/audit.service.js';
import { matchesType } from '../hr/documents.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { RoomsService } from '../pms/rooms.service.js';
import { invalidState, nextNumber } from '../pms/reservations.service.js';

const include = {
  room: { select: { number: true } },
  assignee: { select: { identity: { select: { displayName: true } } } },
  block: { select: { id: true, startDate: true, endDate: true, releasedAt: true } },
  _count: { select: { photos: true } },
} satisfies Prisma.MaintenanceRequestInclude;

type Row = Prisma.MaintenanceRequestGetPayload<{ include: typeof include }>;

const OPEN_STATUSES: MaintenanceStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'];
const PRIORITY_ORDER = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;

/** Which status each work action moves from, and to. */
const TRANSITIONS: Record<'START' | 'HOLD' | 'COMPLETE', [MaintenanceStatus[], MaintenanceStatus]> =
  {
    START: [['ASSIGNED', 'ON_HOLD'], 'IN_PROGRESS'],
    HOLD: [['IN_PROGRESS'], 'ON_HOLD'],
    COMPLETE: [['IN_PROGRESS'], 'DONE'],
  };

const unsupported = (detail: string) =>
  new ProblemException(415, 'UNSUPPORTED_FILE_TYPE', 'Unsupported photo', detail);

/**
 * Maintenance requests (spec §32, ADR-0023). Anyone with maintenance.report files one;
 * managers assign and prioritize; technicians start, hold and complete their work. A
 * request can take its room out of order (an out-of-order block), released on close.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly rooms: RoomsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private get ctx() {
    return {
      organizationId: this.cls.get('organizationId')!,
      propertyId: this.cls.get('propertyId')!,
      actorId: this.cls.get('identityId') ?? null,
      membershipId: this.cls.get('membershipId') ?? null,
    };
  }

  private can(permission: PermissionCode): boolean {
    return this.cls.get('grants')!.hasForProperty(permission, this.ctx.propertyId);
  }

  private async names(tx: Tx, ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (unique.length === 0) return new Map();
    const rows = await tx.identity.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true },
    });
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }

  private toDto(r: Row, names: Map<string, string>): MaintenanceRequest {
    return {
      id: r.id,
      requestNo: r.requestNo,
      roomId: r.roomId,
      roomNumber: r.room?.number ?? null,
      location: r.location,
      category: r.category as MaintenanceRequest['category'],
      priority: r.priority as MaintenanceRequest['priority'],
      status: r.status as MaintenanceStatus,
      title: r.title,
      description: r.description,
      reportedByName: r.reportedBy ? (names.get(r.reportedBy) ?? null) : null,
      assignedMembershipId: r.assignedMembershipId,
      assignedName: r.assignee?.identity.displayName ?? null,
      assignedToMe:
        r.assignedMembershipId !== null && r.assignedMembershipId === this.ctx.membershipId,
      serviceRequestId: r.serviceRequestId,
      outOfOrder: r.block
        ? {
            blockId: r.block.id,
            startDate: fromDbDate(r.block.startDate),
            endDate: fromDbDate(r.block.endDate),
            released: r.block.releasedAt !== null,
          }
        : null,
      resolution: r.resolution,
      photoCount: r._count.photos,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      version: r.version,
    };
  }

  // ---- Queries ----------------------------------------------------------------------------

  async list(query: MaintenanceListQuery): Promise<MaintenanceRequest[]> {
    const { propertyId, membershipId } = this.ctx;
    return this.db.run(async (tx) => {
      const rows = await tx.maintenanceRequest.findMany({
        where: {
          propertyId,
          ...(query.status === 'ACTIVE'
            ? { status: { in: OPEN_STATUSES } }
            : query.status === 'ALL'
              ? {}
              : { status: query.status }),
          ...(query.roomId ? { roomId: query.roomId } : {}),
          ...(query.assignedToMe ? { assignedMembershipId: membershipId ?? '' } : {}),
        },
        include,
        orderBy: { createdAt: 'desc' },
        take: 300,
      });
      const names = await this.names(
        tx,
        rows.map((r) => r.reportedBy),
      );
      // Most urgent first, then oldest first within a priority.
      return rows
        .sort(
          (a, b) =>
            PRIORITY_ORDER[a.priority as keyof typeof PRIORITY_ORDER] -
              PRIORITY_ORDER[b.priority as keyof typeof PRIORITY_ORDER] ||
            a.createdAt.getTime() - b.createdAt.getTime(),
        )
        .map((r) => this.toDto(r, names));
    });
  }

  async detail(id: string): Promise<MaintenanceDetail> {
    return this.db.run(async (tx) => {
      const row = await this.requireRow(tx, id);
      const updates = await tx.maintenanceUpdate.findMany({
        where: { requestId: id },
        orderBy: { at: 'asc' },
      });
      const photos = await tx.maintenancePhoto.findMany({
        where: { requestId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true },
      });
      const names = await this.names(tx, [row.reportedBy, ...updates.map((u) => u.actorId)]);
      return {
        ...this.toDto(row, names),
        updates: updates.map((u) => ({
          id: u.id,
          kind: u.kind as MaintenanceDetail['updates'][number]['kind'],
          fromStatus: u.fromStatus as MaintenanceStatus | null,
          toStatus: u.toStatus as MaintenanceStatus | null,
          note: u.note,
          byName: u.actorId ? (names.get(u.actorId) ?? null) : null,
          at: u.at.toISOString(),
        })),
        photos: photos.map((p) => ({ id: p.id, createdAt: p.createdAt.toISOString() })),
      };
    });
  }

  private async requireRow(tx: Tx, id: string): Promise<Row> {
    const row = await tx.maintenanceRequest.findFirst({
      where: { id, propertyId: this.ctx.propertyId },
      include,
    });
    if (!row) throw Problems.notFound('Maintenance request');
    return row;
  }

  /** Members who can be assigned: maintenance.work at this property. */
  async technicians(): Promise<{ membershipId: string; displayName: string }[]> {
    const rows = await this.db.run((tx) =>
      tx.organizationMembership.findMany({
        where: this.technicianFilter(),
        select: { id: true, identity: { select: { displayName: true } } },
      }),
    );
    return rows
      .map((m) => ({ membershipId: m.id, displayName: m.identity.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  private technicianFilter(): Prisma.OrganizationMembershipWhereInput {
    return {
      status: 'ACTIVE',
      roleAssignments: {
        some: {
          OR: [{ scopeType: 'ORGANIZATION' }, { propertyId: this.ctx.propertyId }],
          role: { permissions: { some: { permissionCode: 'maintenance.work' } } },
        },
      },
    };
  }

  // ---- Commands ---------------------------------------------------------------------------

  async create(input: CreateMaintenanceRequest): Promise<MaintenanceRequest> {
    const { organizationId, propertyId, actorId } = this.ctx;
    if (input.outOfOrder && !this.can('maintenance.manage'))
      throw Problems.forbidden('Taking a room out of order needs maintenance.manage.');

    await this.db.run(async (tx) => {
      if (input.roomId) {
        const room = await tx.room.findFirst({
          where: { id: input.roomId, propertyId, archivedAt: null },
        });
        if (!room) throw Problems.validation([{ path: 'roomId', message: 'Unknown room' }]);
      }
      if (input.serviceRequestId) {
        const sr = await tx.serviceRequest.findFirst({
          where: { id: input.serviceRequestId, propertyId },
        });
        if (!sr)
          throw Problems.validation([
            { path: 'serviceRequestId', message: 'Unknown service request' },
          ]);
      }
    });

    // The block first: it fails cleanly if the room is sold out or booked for the dates.
    const block = input.outOfOrder
      ? await this.rooms.createBlock(input.roomId!, {
          ...input.outOfOrder,
          reason: `Maintenance: ${input.title}`.slice(0, 500),
        })
      : null;
    try {
      const id = uuidv7();
      await this.db.run(async (tx) => {
        const n = await nextNumber(tx, organizationId, propertyId, 'maintenance');
        await tx.maintenanceRequest.create({
          data: {
            id,
            organizationId,
            propertyId,
            requestNo: `MR-${String(n).padStart(5, '0')}`,
            roomId: input.roomId,
            location: input.location,
            category: input.category,
            priority: input.priority,
            title: input.title,
            description: input.description,
            reportedBy: actorId,
            serviceRequestId: input.serviceRequestId,
            blockId: block?.id ?? null,
          },
        });
        await tx.maintenanceUpdate.create({
          data: {
            organizationId,
            requestId: id,
            kind: 'CREATED',
            toStatus: 'OPEN',
            note: input.description || null,
            actorId,
          },
        });
        await this.audit.record(tx, {
          action: 'maintenance.reported',
          entityType: 'maintenance_request',
          entityId: id,
          propertyId,
          after: {
            roomId: input.roomId,
            location: input.location,
            category: input.category,
            priority: input.priority,
            title: input.title,
            outOfOrder: input.outOfOrder,
          },
        });
        await this.outbox.enqueue(
          tx,
          'MaintenanceRequested',
          { requestId: id, roomId: input.roomId, priority: input.priority },
          { propertyId },
        );
      });
      return this.one(id);
    } catch (error) {
      if (block) await this.rooms.releaseBlock(input.roomId!, block.id).catch(() => undefined);
      throw error;
    }
  }

  private async one(id: string): Promise<MaintenanceRequest> {
    return this.db.run(async (tx) => {
      const row = await this.requireRow(tx, id);
      return this.toDto(row, await this.names(tx, [row.reportedBy]));
    });
  }

  /** One workflow step, under optimistic concurrency (If-Match). */
  async act(
    id: string,
    expectedVersion: number,
    action: MaintenanceAction,
  ): Promise<MaintenanceRequest> {
    const { organizationId, propertyId, actorId, membershipId } = this.ctx;
    const manage = this.can('maintenance.manage');
    const work = this.can('maintenance.work');
    const releaseAfter = await this.db.run(async (tx) => {
      const row = await this.requireRow(tx, id);
      if (row.version !== expectedVersion) throw Problems.versionConflict();
      const status = row.status as MaintenanceStatus;
      const closed = status === 'DONE' || status === 'CANCELLED';
      const data: Prisma.MaintenanceRequestUncheckedUpdateManyInput = {};
      let next: MaintenanceStatus = status;
      let note: string | null = null;
      let kind: 'ASSIGNED' | 'STATUS' | 'NOTE' = 'STATUS';

      switch (action.action) {
        case 'ASSIGN': {
          if (!manage) throw Problems.forbidden('Assigning needs maintenance.manage.');
          if (closed) throw invalidState('The request is closed.');
          const tech = await tx.organizationMembership.findFirst({
            where: { id: action.membershipId, ...this.technicianFilter() },
            select: { identity: { select: { displayName: true } } },
          });
          if (!tech)
            throw Problems.validation([
              { path: 'membershipId', message: 'Not a maintenance technician here' },
            ]);
          data.assignedMembershipId = action.membershipId;
          if (status === 'OPEN') next = 'ASSIGNED';
          kind = 'ASSIGNED';
          note = tech.identity.displayName;
          break;
        }
        case 'PRIORITY':
          if (!manage) throw Problems.forbidden('Changing priority needs maintenance.manage.');
          if (closed) throw invalidState('The request is closed.');
          data.priority = action.priority;
          kind = 'NOTE';
          note = `Priority: ${action.priority.toLowerCase()}`;
          break;
        case 'CANCEL':
          if (!manage) throw Problems.forbidden('Cancelling needs maintenance.manage.');
          if (closed) throw invalidState('The request is already closed.');
          next = 'CANCELLED';
          note = action.note;
          data.completedAt = new Date();
          break;
        case 'NOTE':
          if (!work && !manage) throw Problems.forbidden('Notes need maintenance.work.');
          kind = 'NOTE';
          note = action.note;
          break;
        default: {
          // START / HOLD / COMPLETE: the assigned technician, or a manager.
          if (!work && !manage) throw Problems.forbidden('This needs maintenance.work.');
          if (!manage && row.assignedMembershipId !== membershipId)
            throw Problems.forbidden('Only the assigned technician can do this.');
          const [from, to] = TRANSITIONS[action.action];
          if (!from.includes(status))
            throw invalidState(
              `A ${status.toLowerCase().replace('_', ' ')} request cannot do that.`,
            );
          next = to;
          if (action.action === 'START' && !row.startedAt) data.startedAt = new Date();
          if (action.action === 'HOLD') note = action.note;
          if (action.action === 'COMPLETE') {
            note = action.note;
            data.resolution = action.note;
            data.completedAt = new Date();
          }
        }
      }
      if (next !== status) data.status = next;
      const { count } = await tx.maintenanceRequest.updateMany({
        where: { id, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (count !== 1) throw Problems.versionConflict();
      await tx.maintenanceUpdate.create({
        data: {
          organizationId,
          requestId: id,
          kind,
          fromStatus: next !== status ? status : null,
          toStatus: next !== status ? next : null,
          note,
          actorId,
        },
      });
      await this.audit.record(tx, {
        action: `maintenance.${action.action.toLowerCase()}`,
        entityType: 'maintenance_request',
        entityId: id,
        propertyId,
        before: { status, priority: row.priority, assignedMembershipId: row.assignedMembershipId },
        after: { status: next, ...data },
      });
      if (next !== status) {
        await this.outbox.enqueue(
          tx,
          'MaintenanceStatusChanged',
          { requestId: id, from: status, to: next },
          { propertyId },
        );
      }
      // Closing gives the room back to sale.
      return (next === 'DONE' || next === 'CANCELLED') && row.block && !row.block.releasedAt
        ? { roomId: row.roomId!, blockId: row.block.id }
        : null;
    });
    if (releaseAfter) {
      await this.rooms.releaseBlock(releaseAfter.roomId, releaseAfter.blockId).catch((error) => {
        this.logger.error(`Could not release block ${releaseAfter.blockId}: ${String(error)}`);
      });
    }
    return this.one(id);
  }

  // ---- Photos -----------------------------------------------------------------------------

  async addPhoto(
    id: string,
    contentType: string | undefined,
    body: unknown,
  ): Promise<MaintenanceDetail> {
    const { organizationId, actorId, propertyId } = this.ctx;
    const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(MAINTENANCE_PHOTO_TYPES as readonly string[]).includes(type))
      throw unsupported('Upload a JPEG, PNG or WebP photo.');
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw Problems.validation([{ path: 'body', message: 'The photo is empty' }]);
    if (body.length > MAINTENANCE_PHOTO_MAX_BYTES)
      throw new ProblemException(413, 'VALIDATION_FAILED', 'Photo too large', 'At most 8 MiB.');
    if (!matchesType(body, type as (typeof MAINTENANCE_PHOTO_TYPES)[number]))
      throw unsupported(`The file is not a ${type} image.`);
    await this.db.run((tx) => this.requireRow(tx, id));

    const photoId = uuidv7();
    const storageKey = `${organizationId}/maintenance-photos/${photoId}`;
    const sha256 = createHash('sha256').update(body).digest('hex');
    await this.storage.put(storageKey, body, type, sha256);
    try {
      await this.db.run(async (tx) => {
        await this.requireRow(tx, id);
        await tx.maintenancePhoto.create({
          data: {
            id: photoId,
            organizationId,
            requestId: id,
            storageKey,
            contentType: type,
            sizeBytes: body.length,
            sha256,
            uploadedBy: actorId,
          },
        });
        await tx.maintenanceUpdate.create({
          data: { organizationId, requestId: id, kind: 'PHOTO', actorId },
        });
        await this.audit.record(tx, {
          action: 'maintenance.photo_added',
          entityType: 'maintenance_request',
          entityId: id,
          propertyId,
          after: { photoId, sha256 },
        });
      });
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
    return this.detail(id);
  }

  async openPhoto(
    id: string,
    photoId: string,
  ): Promise<{ contentType: string; sizeBytes: number; stream: Readable }> {
    const photo = await this.db.run(async (tx) => {
      await this.requireRow(tx, id);
      const photo = await tx.maintenancePhoto.findFirst({ where: { id: photoId, requestId: id } });
      if (!photo) throw Problems.notFound('Photo');
      return photo;
    });
    try {
      return {
        contentType: photo.contentType,
        sizeBytes: photo.sizeBytes,
        stream: await this.storage.get(photo.storageKey),
      };
    } catch (error) {
      if (error instanceof ObjectNotFound) throw Problems.notFound('Photo');
      throw error;
    }
  }
}
