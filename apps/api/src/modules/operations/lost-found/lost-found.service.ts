import { Injectable } from '@nestjs/common';
import {
  type CloseLostFoundItem,
  type CreateLostFoundItem,
  LOST_FOUND_CLOSED_STATUSES,
  type LostFoundItem,
  type LostFoundListQuery,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { nextNumber } from '../../../common/numbering.js';
import { Problems, invalidState } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';

const include = { room: { select: { number: true } } } satisfies Prisma.LostFoundItemInclude;
type Row = Prisma.LostFoundItemGetPayload<{ include: typeof include }>;

/**
 * Lost & found (spec §31, ADR-0023): items are logged where they were found and stored,
 * then returned to their owner (with how ownership was checked) or disposed of.
 */
@Injectable()
export class LostFoundService {
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

  private async toDtos(tx: Tx, rows: Row[]): Promise<LostFoundItem[]> {
    const ids = [...new Set(rows.flatMap((r) => (r.foundBy ? [r.foundBy] : [])))];
    const names = new Map(
      ids.length === 0
        ? []
        : (
            await tx.identity.findMany({
              where: { id: { in: ids } },
              select: { id: true, displayName: true },
            })
          ).map((i) => [i.id, i.displayName]),
    );
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      itemNo: r.itemNo,
      description: r.description,
      category: r.category as LostFoundItem['category'],
      foundAt: r.foundAt.toISOString(),
      foundLocation: r.foundLocation,
      roomNumber: r.room?.number ?? null,
      storageLocation: r.storageLocation,
      foundByName: r.foundBy ? (names.get(r.foundBy) ?? null) : null,
      status: r.status as LostFoundItem['status'],
      closingNote: r.closingNote,
      closedAt: r.closedAt?.toISOString() ?? null,
      daysHeld: Math.floor(((r.closedAt?.getTime() ?? now) - r.foundAt.getTime()) / 86_400_000),
      version: r.version,
    }));
  }

  async list(query: LostFoundListQuery): Promise<LostFoundItem[]> {
    return this.db.run(async (tx) => {
      const rows = await tx.lostFoundItem.findMany({
        where: {
          propertyId: this.ctx.propertyId,
          ...(query.status === 'HELD'
            ? { status: 'HELD' }
            : query.status === 'CLOSED'
              ? { status: { in: [...LOST_FOUND_CLOSED_STATUSES] } }
              : {}),
          ...(query.q
            ? {
                OR: [
                  { description: { contains: query.q, mode: 'insensitive' } },
                  { itemNo: { contains: query.q, mode: 'insensitive' } },
                  { foundLocation: { contains: query.q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include,
        orderBy: { foundAt: 'desc' },
        take: 300,
      });
      return this.toDtos(tx, rows);
    });
  }

  async create(input: CreateLostFoundItem): Promise<LostFoundItem> {
    const { organizationId, propertyId, actorId } = this.ctx;
    return this.db.run(async (tx) => {
      if (input.roomId) {
        const room = await tx.room.findFirst({ where: { id: input.roomId, propertyId } });
        if (!room) throw Problems.validation([{ path: 'roomId', message: 'Unknown room' }]);
      }
      const foundAt = input.foundAt ? new Date(input.foundAt) : new Date();
      if (foundAt.getTime() > Date.now() + 60_000)
        throw Problems.validation([{ path: 'foundAt', message: 'Cannot be in the future' }]);
      const n = await nextNumber(tx, organizationId, propertyId, 'lost_found');
      const row = await tx.lostFoundItem.create({
        data: {
          organizationId,
          propertyId,
          itemNo: `LF-${String(n).padStart(5, '0')}`,
          description: input.description,
          category: input.category,
          foundAt,
          foundLocation: input.foundLocation,
          roomId: input.roomId,
          storageLocation: input.storageLocation,
          foundBy: actorId,
        },
        include,
      });
      await this.audit.record(tx, {
        action: 'lost_found.logged',
        entityType: 'lost_found_item',
        entityId: row.id,
        propertyId,
        after: { itemNo: row.itemNo, category: input.category, foundLocation: input.foundLocation },
      });
      await this.outbox.enqueue(tx, 'LostItemLogged', { itemId: row.id }, { propertyId });
      return (await this.toDtos(tx, [row]))[0]!;
    });
  }

  async close(
    id: string,
    expectedVersion: number,
    input: CloseLostFoundItem,
  ): Promise<LostFoundItem> {
    const { propertyId, actorId } = this.ctx;
    return this.db.run(async (tx) => {
      const item = await tx.lostFoundItem.findFirst({ where: { id, propertyId } });
      if (!item) throw Problems.notFound('Item');
      if (item.status !== 'HELD')
        throw invalidState('The item was already returned or disposed of.');
      const { count } = await tx.lostFoundItem.updateMany({
        where: { id, version: expectedVersion, status: 'HELD' },
        data: {
          status: input.status,
          closingNote: input.note,
          closedAt: new Date(),
          closedBy: actorId,
          version: { increment: 1 },
        },
      });
      if (count !== 1) throw Problems.versionConflict();
      await this.audit.record(tx, {
        action: input.status === 'RETURNED' ? 'lost_found.returned' : 'lost_found.disposed',
        entityType: 'lost_found_item',
        entityId: id,
        propertyId,
        after: { note: input.note },
      });
      const row = await tx.lostFoundItem.findUniqueOrThrow({ where: { id }, include });
      return (await this.toDtos(tx, [row]))[0]!;
    });
  }
}
