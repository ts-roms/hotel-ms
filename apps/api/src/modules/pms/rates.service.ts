import { Injectable } from '@nestjs/common';
import type {
  Availability,
  AvailabilityQuery,
  CreateRatePlanRequest,
  Quote,
  QuoteQuery,
  RatePlan,
  SetRateOverridesRequest,
  UpdateRatePlanRequest,
} from '@hotel/contracts';
import { Prisma } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { daysBetween, nightsOf, toDbDate } from '../../common/dates.js';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { readInventory } from './inventory.js';
import { priceStay, toMinor } from './pricing.js';

const MAX_AVAILABILITY_DAYS = 62;
const MAX_OVERRIDE_DAYS = 366;

@Injectable()
export class RatesService {
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

  async list(): Promise<RatePlan[]> {
    const rows = await this.db.run((tx) =>
      tx.ratePlan.findMany({
        where: { propertyId: this.ctx.propertyId },
        include: { roomTypePrices: true },
        orderBy: { code: 'asc' },
      }),
    );
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      cancellationPolicy: p.cancellationPolicy,
      currency: p.currency,
      archived: p.archivedAt !== null,
      prices: p.roomTypePrices.map((x) => ({
        roomTypeId: x.roomTypeId,
        baseAmountMinor: toMinor(x.baseAmountMinor),
      })),
      version: p.version,
    }));
  }

  private async get(ratePlanId: string): Promise<RatePlan> {
    const plan = (await this.list()).find((p) => p.id === ratePlanId);
    if (!plan) throw Problems.notFound('Rate plan');
    return plan;
  }

  private async assertRoomTypes(
    tx: Prisma.TransactionClient,
    roomTypeIds: string[],
  ): Promise<void> {
    if (roomTypeIds.length === 0) return;
    const found = await tx.roomType.count({
      where: { id: { in: roomTypeIds }, propertyId: this.ctx.propertyId },
    });
    if (found !== new Set(roomTypeIds).size) {
      throw Problems.validation([{ path: 'prices', message: 'Unknown room type' }]);
    }
  }

  async create(input: CreateRatePlanRequest): Promise<RatePlan> {
    const { organizationId, propertyId, actorId } = this.ctx;
    try {
      const plan = await this.db.run(async (tx) => {
        await this.assertRoomTypes(
          tx,
          input.prices.map((p) => p.roomTypeId),
        );
        const property = await tx.property.findUniqueOrThrow({
          where: { id: propertyId },
          select: { currency: true },
        });
        const created = await tx.ratePlan.create({
          data: {
            organizationId,
            propertyId,
            code: input.code,
            name: input.name,
            description: input.description,
            cancellationPolicy: input.cancellationPolicy,
            currency: property.currency,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
        await tx.ratePlanRoomType.createMany({
          data: input.prices.map((p) => ({
            organizationId,
            ratePlanId: created.id,
            roomTypeId: p.roomTypeId,
            baseAmountMinor: BigInt(p.baseAmountMinor),
          })),
        });
        await this.audit.record(tx, {
          action: 'rate_plan.created',
          entityType: 'rate_plan',
          entityId: created.id,
          propertyId,
          after: input,
        });
        return created;
      });
      return this.get(plan.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw Problems.conflict('A rate plan with this code already exists at this property.');
      }
      throw error;
    }
  }

  async update(
    ratePlanId: string,
    expectedVersion: number,
    input: UpdateRatePlanRequest,
  ): Promise<RatePlan> {
    const { organizationId, propertyId, actorId } = this.ctx;
    const before = await this.get(ratePlanId);
    await this.db.run(async (tx) => {
      const { prices, ...fields } = input;
      const updated = await tx.ratePlan.updateMany({
        where: { id: ratePlanId, propertyId, version: expectedVersion },
        data: { ...fields, updatedBy: actorId, version: { increment: 1 } },
      });
      if (updated.count === 0) throw Problems.versionConflict();
      if (prices) {
        await this.assertRoomTypes(
          tx,
          prices.map((p) => p.roomTypeId),
        );
        await tx.ratePlanRoomType.deleteMany({ where: { ratePlanId } });
        await tx.ratePlanRoomType.createMany({
          data: prices.map((p) => ({
            organizationId,
            ratePlanId,
            roomTypeId: p.roomTypeId,
            baseAmountMinor: BigInt(p.baseAmountMinor),
          })),
        });
      }
      // Price changes never touch existing bookings: nights are priced at booking time.
      await this.audit.record(tx, {
        action: 'rate_plan.updated',
        entityType: 'rate_plan',
        entityId: ratePlanId,
        propertyId,
        before: { name: before.name, prices: before.prices },
        after: input,
      });
    });
    return this.get(ratePlanId);
  }

  async setOverrides(ratePlanId: string, input: SetRateOverridesRequest): Promise<void> {
    const { organizationId, propertyId } = this.ctx;
    if (daysBetween(input.from, input.to) > MAX_OVERRIDE_DAYS) {
      throw Problems.validation([
        { path: 'to', message: `At most ${MAX_OVERRIDE_DAYS} days at a time` },
      ]);
    }
    await this.db.run(async (tx) => {
      const plan = await tx.ratePlan.findFirst({ where: { id: ratePlanId, propertyId } });
      if (!plan) throw Problems.notFound('Rate plan');
      await this.assertRoomTypes(tx, [input.roomTypeId]);
      await tx.rateOverride.deleteMany({
        where: {
          ratePlanId,
          roomTypeId: input.roomTypeId,
          stayDate: { gte: toDbDate(input.from), lt: toDbDate(input.to) },
        },
      });
      if (input.amountMinor !== null) {
        await tx.rateOverride.createMany({
          data: nightsOf(input.from, input.to).map((date) => ({
            organizationId,
            ratePlanId,
            roomTypeId: input.roomTypeId,
            stayDate: toDbDate(date),
            amountMinor: BigInt(input.amountMinor!),
          })),
        });
      }
      await this.audit.record(tx, {
        action: 'rate_plan.overrides_set',
        entityType: 'rate_plan',
        entityId: ratePlanId,
        propertyId,
        after: input,
      });
    });
  }

  async quote(query: QuoteQuery): Promise<Quote> {
    return this.db.run(async (tx) => {
      const roomType = await tx.roomType.findFirst({
        where: { id: query.roomTypeId, propertyId: this.ctx.propertyId },
      });
      if (!roomType)
        throw Problems.validation([{ path: 'roomTypeId', message: 'Unknown room type' }]);
      const plan = await tx.ratePlan.findFirst({
        where: { id: query.ratePlanId, propertyId: this.ctx.propertyId },
      });
      if (!plan) throw Problems.validation([{ path: 'ratePlanId', message: 'Unknown rate plan' }]);
      const priced = await priceStay(
        tx,
        query.ratePlanId,
        query.roomTypeId,
        nightsOf(query.arrivalDate, query.departureDate),
      );
      return {
        currency: priced.currency,
        nights: priced.nights.map((n) => ({ date: n.date, amountMinor: toMinor(n.amountMinor) })),
        totalMinor: toMinor(priced.nights.reduce((sum, n) => sum + n.amountMinor, 0n)),
      };
    });
  }

  async availability(query: AvailabilityQuery): Promise<Availability> {
    if (daysBetween(query.from, query.to) > MAX_AVAILABILITY_DAYS) {
      throw Problems.validation([
        { path: 'to', message: `At most ${MAX_AVAILABILITY_DAYS} days at a time` },
      ]);
    }
    const dates = nightsOf(query.from, query.to);
    return this.db.run(async (tx) => {
      const roomTypes = await tx.roomType.findMany({
        where: { propertyId: this.ctx.propertyId, archivedAt: null },
        include: { _count: { select: { rooms: { where: { archivedAt: null } } } } },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      });
      const rows = await readInventory(
        tx,
        roomTypes.map((rt) => ({ id: rt.id, activeRooms: rt._count.rooms })),
        dates,
      );
      return {
        from: query.from,
        to: query.to,
        roomTypes: roomTypes.map((rt) => ({
          roomTypeId: rt.id,
          code: rt.code,
          name: rt.name,
          nights: rows
            .filter((r) => r.roomTypeId === rt.id)
            .map((r) => ({
              date: r.date,
              capacity: r.capacity,
              sold: r.sold,
              blocked: r.blocked,
              available: Math.max(0, r.capacity - r.sold - r.blocked),
            })),
        })),
      };
    });
  }
}
