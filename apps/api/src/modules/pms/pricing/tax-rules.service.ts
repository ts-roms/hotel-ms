import { Injectable } from '@nestjs/common';
import type { CreateTaxRuleRequest, TaxRule } from '@hotel/contracts';
import { Prisma, type Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import type { TaxRuleInput } from './tax-engine.js';

/**
 * Tax and fee rules per property (Pricing, blueprint §6.1). Finance and F&B read the
 * rules in force when they post; the ledger keeps the tax each line was posted with.
 */
@Injectable()
export class TaxRulesService {
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

  /** Active tax rules for a department, in posting order. */
  async taxRulesFor(tx: Tx, propertyId: string, department: string): Promise<TaxRuleInput[]> {
    const rules = await tx.taxRule.findMany({
      where: { propertyId, archivedAt: null, departments: { has: department } },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rules.map((r) => ({
      code: r.code,
      name: r.name,
      rateBps: r.rateBps,
      inclusive: r.inclusive,
    }));
  }

  async listTaxRules(): Promise<TaxRule[]> {
    const rows = await this.db.run((tx) =>
      tx.taxRule.findMany({
        where: { propertyId: this.ctx.propertyId },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      rateBps: r.rateBps,
      inclusive: r.inclusive,
      departments: r.departments as TaxRule['departments'],
      archived: r.archivedAt !== null,
    }));
  }

  /** New rules apply to postings from now on; history keeps the tax it was posted with. */
  async createTaxRule(input: CreateTaxRuleRequest): Promise<TaxRule> {
    const { organizationId, propertyId, actorId } = this.ctx;
    try {
      const rule = await this.db.run(async (tx) => {
        const created = await tx.taxRule.create({
          data: { organizationId, propertyId, ...input, createdBy: actorId },
        });
        await this.audit.record(tx, {
          action: 'tax_rule.created',
          entityType: 'tax_rule',
          entityId: created.id,
          propertyId,
          after: input,
        });
        return created;
      });
      return (await this.listTaxRules()).find((r) => r.id === rule.id)!;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw Problems.conflict(`A tax with code ${input.code} already exists.`);
      }
      throw error;
    }
  }

  async archiveTaxRule(taxRuleId: string): Promise<void> {
    const { propertyId } = this.ctx;
    await this.db.run(async (tx) => {
      const rule = await tx.taxRule.findFirst({ where: { id: taxRuleId, propertyId } });
      if (!rule) throw Problems.notFound('Tax rule');
      if (rule.archivedAt) return;
      await tx.taxRule.update({ where: { id: taxRuleId }, data: { archivedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'tax_rule.archived',
        entityType: 'tax_rule',
        entityId: taxRuleId,
        propertyId,
      });
    });
  }
}
