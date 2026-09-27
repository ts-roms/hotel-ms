import { Injectable } from '@nestjs/common';
import type { CreatePropertyRequest, Property, UpdatePropertyRequest } from '@hotel/contracts';
import { Prisma, type Property as PropertyRow } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService, diffFields } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

const AUDITED_FIELDS = [
  'name',
  'status',
  'brandId',
  'locale',
  'countryCode',
  'addressLine1',
  'addressLine2',
  'city',
  'region',
  'postalCode',
  'phone',
  'email',
  'checkInTime',
  'checkOutTime',
] as const satisfies readonly (keyof PropertyRow)[];

@Injectable()
export class PropertiesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async list(page: {
    cursor?: string;
    limit: number;
  }): Promise<{ items: Property[]; nextCursor: string | null }> {
    const scope = this.cls.get('grants')!.propertyScope('property.read');
    const rows = await this.db.run((tx) =>
      tx.property.findMany({
        where: {
          ...(scope.kind === 'some' ? { id: { in: scope.propertyIds } } : {}),
          ...(page.cursor ? { code: { gt: page.cursor } } : {}),
        },
        orderBy: { code: 'asc' },
        take: page.limit + 1,
      }),
    );
    const items = rows.slice(0, page.limit);
    return {
      items: items.map(toDto),
      nextCursor: rows.length > page.limit ? items.at(-1)!.code : null,
    };
  }

  async get(propertyId: string): Promise<Property> {
    const row = await this.db.run((tx) => tx.property.findUnique({ where: { id: propertyId } }));
    if (!row) throw Problems.notFound('Property');
    return toDto(row);
  }

  async create(input: CreatePropertyRequest): Promise<Property> {
    const organizationId = this.cls.get('organizationId')!;
    const identityId = this.cls.get('identityId') ?? null;
    const businessDate = input.currentBusinessDate ?? todayIn(input.timezone);

    try {
      return await this.db.run(async (tx) => {
        const row = await tx.property.create({
          data: {
            organizationId,
            brandId: input.brandId ?? null,
            code: input.code,
            name: input.name,
            timezone: input.timezone,
            currency: input.currency,
            locale: input.locale,
            countryCode: input.countryCode,
            addressLine1: input.addressLine1 ?? null,
            addressLine2: input.addressLine2 ?? null,
            city: input.city ?? null,
            region: input.region ?? null,
            postalCode: input.postalCode ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            checkInTime: input.checkInTime,
            checkOutTime: input.checkOutTime,
            currentBusinessDate: new Date(`${businessDate}T00:00:00Z`),
            createdBy: identityId,
            updatedBy: identityId,
          },
        });
        const dto = toDto(row);
        await this.audit.record(tx, {
          action: 'property.created',
          entityType: 'property',
          entityId: row.id,
          propertyId: row.id,
          after: dto,
        });
        await this.outbox.enqueue(
          tx,
          'PropertyCreated',
          { propertyId: row.id, code: row.code, name: row.name },
          { propertyId: row.id },
        );
        return dto;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw Problems.conflict(
          `Property code ${input.code} is already used in this organization.`,
        );
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw Problems.validation([{ path: 'brandId', message: 'Unknown brand' }]);
      }
      throw error;
    }
  }

  /** Optimistic concurrency: the update only applies if `expectedVersion` is current. */
  async update(
    propertyId: string,
    expectedVersion: number,
    input: UpdatePropertyRequest,
  ): Promise<Property> {
    const identityId = this.cls.get('identityId') ?? null;
    return this.db.run(async (tx) => {
      const before = await tx.property.findUnique({ where: { id: propertyId } });
      if (!before) throw Problems.notFound('Property');

      const result = await tx.property.updateMany({
        where: { id: propertyId, version: expectedVersion },
        data: { ...input, updatedBy: identityId, version: { increment: 1 } },
      });
      if (result.count === 0) throw Problems.versionConflict();

      const after = await tx.property.findUniqueOrThrow({ where: { id: propertyId } });
      const diff = diffFields(before, after, AUDITED_FIELDS);
      if (diff.changed.length > 0) {
        await this.audit.record(tx, {
          action: 'property.updated',
          entityType: 'property',
          entityId: propertyId,
          propertyId,
          before: diff.before as Prisma.InputJsonValue,
          after: diff.after as Prisma.InputJsonValue,
        });
        await this.outbox.enqueue(
          tx,
          'PropertyUpdated',
          { propertyId, changedFields: diff.changed },
          { propertyId },
        );
      }
      return toDto(after);
    });
  }
}

function toDto(row: PropertyRow): Property {
  return {
    id: row.id,
    organizationId: row.organizationId,
    brandId: row.brandId,
    code: row.code,
    name: row.name,
    status: row.status,
    timezone: row.timezone,
    currency: row.currency,
    locale: row.locale,
    countryCode: row.countryCode,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    phone: row.phone,
    email: row.email,
    checkInTime: row.checkInTime,
    checkOutTime: row.checkOutTime,
    currentBusinessDate: row.currentBusinessDate.toISOString().slice(0, 10),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Calendar date "now" in an IANA time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
