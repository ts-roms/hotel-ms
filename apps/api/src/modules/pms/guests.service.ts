import { Injectable } from '@nestjs/common';
import type {
  CreateGuestRequest,
  Guest,
  GuestSearchQuery,
  PermissionCode,
  UpdateGuestRequest,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';

type GuestRow = Prisma.GuestGetPayload<object>;

export function toGuestDto(g: GuestRow): Guest {
  return {
    id: g.id,
    firstName: g.firstName,
    lastName: g.lastName,
    email: g.email,
    phone: g.phone,
    countryCode: g.countryCode,
    notes: g.notes,
    version: g.version,
    createdAt: g.createdAt.toISOString(),
  };
}

export const toGuestSummary = (g: Pick<GuestRow, 'id' | 'firstName' | 'lastName' | 'email'>) => ({
  id: g.id,
  firstName: g.firstName,
  lastName: g.lastName,
  email: g.email,
});

/**
 * Guest profiles are organization-wide (decision D3). Property-scoped staff see a guest
 * only if it was created at, or has a booking at, one of their properties.
 */
@Injectable()
export class GuestsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  visibilityFilter(permission: PermissionCode): Prisma.GuestWhereInput {
    const scope = this.cls.get('grants')!.propertyScope(permission);
    if (scope.kind === 'all') return {};
    return {
      OR: [
        { createdAtPropertyId: { in: scope.propertyIds } },
        { reservationRooms: { some: { propertyId: { in: scope.propertyIds } } } },
      ],
    };
  }

  /** Throws 404 unless the guest exists and is visible for `permission`. */
  async requireVisible(
    tx: Tx,
    guestId: string,
    permission: PermissionCode = 'guest.read',
  ): Promise<GuestRow> {
    const guest = await tx.guest.findFirst({
      where: { id: guestId, archivedAt: null, ...this.visibilityFilter(permission) },
    });
    if (!guest) throw Problems.notFound('Guest');
    return guest;
  }

  async search(query: GuestSearchQuery): Promise<Guest[]> {
    const q = query.q?.toLowerCase();
    const rows = await this.db.run((tx) =>
      tx.guest.findMany({
        where: {
          archivedAt: null,
          ...this.visibilityFilter('guest.read'),
          ...(q
            ? {
                AND: [
                  {
                    OR: [
                      { firstName: { contains: q, mode: 'insensitive' } },
                      { lastName: { contains: q, mode: 'insensitive' } },
                      { email: { contains: q, mode: 'insensitive' } },
                      { phone: { contains: q } },
                    ],
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: query.limit,
      }),
    );
    return rows.map(toGuestDto);
  }

  async get(guestId: string): Promise<Guest> {
    return toGuestDto(await this.db.run((tx) => this.requireVisible(tx, guestId)));
  }

  /** Creates a guest attributed to a property (used by the route and by reservations). */
  async createInTx(tx: Tx, propertyId: string, input: CreateGuestRequest): Promise<GuestRow> {
    const actorId = this.cls.get('identityId') ?? null;
    const guest = await tx.guest.create({
      data: {
        organizationId: this.cls.get('organizationId')!,
        ...input,
        createdAtPropertyId: propertyId,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    await this.audit.record(tx, {
      action: 'guest.created',
      entityType: 'guest',
      entityId: guest.id,
      propertyId,
      // Minimal personal data in the audit trail (blueprint §20.2).
      after: { firstName: input.firstName, lastName: input.lastName },
    });
    return guest;
  }

  async create(input: CreateGuestRequest): Promise<Guest> {
    const propertyId = this.cls.get('propertyId')!;
    return toGuestDto(await this.db.run((tx) => this.createInTx(tx, propertyId, input)));
  }

  async update(
    guestId: string,
    expectedVersion: number,
    input: UpdateGuestRequest,
  ): Promise<Guest> {
    const actorId = this.cls.get('identityId') ?? null;
    return this.db.run(async (tx) => {
      await this.requireVisible(tx, guestId, 'guest.update');
      const updated = await tx.guest.updateMany({
        where: { id: guestId, version: expectedVersion },
        data: { ...input, updatedBy: actorId, version: { increment: 1 } },
      });
      if (updated.count === 0) throw Problems.versionConflict();
      await this.audit.record(tx, {
        action: 'guest.updated',
        entityType: 'guest',
        entityId: guestId,
        // Field names only: the values are personal data.
        after: { changedFields: Object.keys(input) },
      });
      return toGuestDto(await tx.guest.findUniqueOrThrow({ where: { id: guestId } }));
    });
  }
}
