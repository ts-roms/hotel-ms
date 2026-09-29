import { Injectable } from '@nestjs/common';
import type {
  CreateDiscountProfileRequest,
  DiscountProfile,
  ExchangeRate,
  SetExchangeRateRequest,
} from '@hotel/contracts';
import type { Prisma } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { isUniqueViolation } from '../../../common/db-errors.js';
import { currencyDigits, formatRate, parseRateMicros } from '../../../common/money.js';
import { Problems } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';

function toRateDto(r: Prisma.ExchangeRateGetPayload<object>): ExchangeRate {
  return {
    id: r.id,
    currency: r.currency,
    rate: formatRate(r.rateMicros),
    effectiveFrom: r.effectiveFrom.toISOString(),
  };
}

function toProfileDto(p: Prisma.DiscountProfileGetPayload<object>): DiscountProfile {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    discountPercent: p.discountBps / 100,
    exemptTaxCodes: p.exemptTaxCodes,
    departments: p.departments,
    active: p.archivedAt === null,
  };
}

/**
 * Property finance configuration (ADR-0018): exchange rates for foreign cash, and
 * statutory discount profiles. Rates are append-only history; a new rate supersedes the
 * old one from now on, and every payment keeps the rate it used.
 */
@Injectable()
export class FinanceSettingsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /** Latest rate per currency first, then the history. */
  async exchangeRates(propertyId: string): Promise<ExchangeRate[]> {
    const rows = await this.db.run((tx) =>
      tx.exchangeRate.findMany({
        where: { propertyId },
        orderBy: [{ currency: 'asc' }, { effectiveFrom: 'desc' }],
        take: 200,
      }),
    );
    return rows.map(toRateDto);
  }

  async setExchangeRate(propertyId: string, input: SetExchangeRateRequest): Promise<ExchangeRate> {
    try {
      currencyDigits(input.currency);
    } catch {
      throw Problems.validation([{ path: 'currency', message: 'Unknown currency' }]);
    }
    return this.db.run(async (tx) => {
      const property = await tx.property.findUniqueOrThrow({ where: { id: propertyId } });
      if (input.currency === property.currency) {
        throw Problems.validation([{ path: 'currency', message: 'That is the property currency' }]);
      }
      const rateMicros = parseRateMicros(input.rate);
      if (rateMicros <= 0n)
        throw Problems.validation([{ path: 'rate', message: 'Must be greater than zero' }]);
      const row = await tx.exchangeRate.create({
        data: {
          organizationId: this.cls.get('organizationId')!,
          propertyId,
          currency: input.currency,
          rateMicros,
          createdBy: this.cls.get('identityId') ?? null,
        },
      });
      await this.audit.record(tx, {
        action: 'finance.exchange_rate_set',
        entityType: 'exchange_rate',
        entityId: row.id,
        propertyId,
        after: { currency: input.currency, rate: formatRate(rateMicros) },
      });
      return toRateDto(row);
    });
  }

  async discountProfiles(propertyId: string): Promise<DiscountProfile[]> {
    const rows = await this.db.run((tx) =>
      tx.discountProfile.findMany({
        where: { propertyId },
        orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { code: 'asc' }],
      }),
    );
    return rows.map(toProfileDto);
  }

  async createDiscountProfile(
    propertyId: string,
    input: CreateDiscountProfileRequest,
  ): Promise<DiscountProfile> {
    try {
      return await this.db.run(async (tx) => {
        const row = await tx.discountProfile.create({
          data: {
            organizationId: this.cls.get('organizationId')!,
            propertyId,
            code: input.code,
            name: input.name,
            discountBps: Math.round(input.discountPercent * 100),
            exemptTaxCodes: [...new Set(input.exemptTaxCodes)],
            departments: [...new Set(input.departments)],
          },
        });
        await this.audit.record(tx, {
          action: 'finance.discount_profile_created',
          entityType: 'discount_profile',
          entityId: row.id,
          propertyId,
          after: { ...input },
        });
        return toProfileDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw Problems.conflict(`A discount with code ${input.code} already exists.`);
      throw error;
    }
  }

  /** Archived profiles stay on the folios that used them; new folios cannot pick them. */
  async archiveDiscountProfile(propertyId: string, id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const { count } = await tx.discountProfile.updateMany({
        where: { id, propertyId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      if (count === 0) throw Problems.notFound('Discount profile');
      await this.audit.record(tx, {
        action: 'finance.discount_profile_archived',
        entityType: 'discount_profile',
        entityId: id,
        propertyId,
      });
    });
  }
}
