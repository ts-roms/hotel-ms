import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AuditLogEntry,
  auditLogEntrySchema,
  type AuditLogQuery,
  auditLogQuerySchema,
  cursorPage,
} from '@hotel/contracts';
import type { Prisma } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/request-context.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodQuery, ZodResponse } from '../../common/zod.js';
import { TenantDb } from '../../infrastructure/database.js';

@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly db: TenantDb,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /**
   * Organization-scoped holders see everything; property-scoped holders see only entries
   * for their properties (organization-level entries are hidden from them).
   */
  @Get()
  @RequirePermission('audit.read', 'any')
  @ZodResponse(200, cursorPage(auditLogEntrySchema))
  async list(@ZodQuery(auditLogQuerySchema) query: AuditLogQuery) {
    const scope = this.cls.get('grants')!.propertyScope('audit.read');

    const propertyFilter: Prisma.AuditLogWhereInput =
      scope.kind === 'all'
        ? query.propertyId
          ? { propertyId: query.propertyId }
          : {}
        : {
            propertyId: {
              in: query.propertyId
                ? scope.propertyIds.filter((id) => id === query.propertyId)
                : scope.propertyIds,
            },
          };

    const rows = await this.db.run((tx) =>
      tx.auditLog.findMany({
        where: {
          ...propertyFilter,
          ...(query.entityType ? { entityType: query.entityType } : {}),
          ...(query.entityId ? { entityId: query.entityId } : {}),
          // UUIDv7 ids are time-ordered, so id order is chronological.
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );

    const items = rows.slice(0, query.limit);
    return {
      items: items.map((r): AuditLogEntry => ({
        id: r.id,
        organizationId: r.organizationId,
        propertyId: r.propertyId,
        actorType: r.actorType,
        actorId: r.actorId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
        requestId: r.requestId,
        occurredAt: r.occurredAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? items.at(-1)!.id : null,
    };
  }
}
