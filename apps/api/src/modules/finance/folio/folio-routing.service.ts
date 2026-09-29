import { Injectable } from '@nestjs/common';
import type { AccountFolio, Folio, RoutingRule } from '@hotel/contracts';
import { uuidv7 } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { businessDateOf } from '../../../common/business-date.js';
import { toDbDate } from '../../../common/dates.js';
import { nextNumber } from '../../../common/numbering.js';
import { Problems, invalidState } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { toSignedMinor } from './folio-dto.js';
import { FolioService } from './folio.service.js';

/**
 * Company and group accounts (folios without a stay), routing rules that send a
 * department's charges to another folio, and transfers of posted charges (§15.1).
 */
@Injectable()
export class FolioRoutingService {
  constructor(
    private readonly db: TenantDb,
    private readonly folios: FolioService,
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

  /** Company / group master account: a folio without a stay (city ledger). */
  async createAccount(label: string): Promise<Folio> {
    const { organizationId, propertyId } = this.ctx;
    return this.db.run(async (tx) => {
      const property = await tx.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { code: true, currency: true },
      });
      const n = await nextNumber(tx, organizationId, propertyId, 'folio');
      const folio = await tx.folio.create({
        data: {
          organizationId,
          propertyId,
          folioNo: `${property.code}-F${String(n).padStart(6, '0')}`,
          label,
          currency: property.currency,
        },
      });
      await this.audit.record(tx, {
        action: 'folio.account_created',
        entityType: 'folio',
        entityId: folio.id,
        propertyId,
        after: { label },
      });
      return this.folios.loadInTx(tx, folio.id);
    });
  }

  async accounts(): Promise<AccountFolio[]> {
    const rows = await this.db.run((tx) =>
      tx.folio.findMany({
        where: { propertyId: this.ctx.propertyId, reservationRoomId: null, label: { not: null } },
        orderBy: { label: 'asc' },
      }),
    );
    return rows.map((f) => ({
      id: f.id,
      folioNo: f.folioNo,
      label: f.label!,
      status: f.status,
      balanceMinor: toSignedMinor(f.balanceMinor),
    }));
  }

  async routingRules(folioId: string): Promise<RoutingRule[]> {
    return this.db.run(async (tx) => {
      await this.folios.requireInTx(tx, folioId);
      const rows = await tx.folioRoutingRule.findMany({
        where: { sourceFolioId: folioId, removedAt: null },
        include: { target: { select: { folioNo: true, label: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        sourceFolioId: r.sourceFolioId,
        targetFolioId: r.targetFolioId,
        targetFolioNo: r.target.folioNo,
        targetLabel: r.target.label,
        departments: r.departments as RoutingRule['departments'],
      }));
    });
  }

  async addRoutingRule(
    folioId: string,
    targetFolioId: string,
    departments: string[],
  ): Promise<RoutingRule[]> {
    const { organizationId, propertyId, actorId } = this.ctx;
    await this.db.run(async (tx) => {
      const source = await this.folios.requireInTx(tx, folioId);
      const target = await tx.folio.findFirst({ where: { id: targetFolioId, propertyId } });
      if (!target || target.id === source.id) {
        throw Problems.validation([{ path: 'targetFolioId', message: 'Unknown or same folio' }]);
      }
      if (source.status !== 'OPEN' || target.status !== 'OPEN') {
        throw invalidState('Both folios must be open.');
      }
      const overlapping = await tx.folioRoutingRule.count({
        where: { sourceFolioId: folioId, removedAt: null, departments: { hasSome: departments } },
      });
      if (overlapping) throw Problems.conflict('A department is already routed from this folio.');
      const rule = await tx.folioRoutingRule.create({
        data: {
          organizationId,
          propertyId,
          sourceFolioId: folioId,
          targetFolioId,
          departments,
          createdBy: actorId,
        },
      });
      await this.audit.record(tx, {
        action: 'folio.routing_added',
        entityType: 'folio',
        entityId: folioId,
        propertyId,
        after: { ruleId: rule.id, targetFolioId, departments },
      });
    });
    return this.routingRules(folioId);
  }

  async removeRoutingRule(ruleId: string): Promise<void> {
    await this.db.run(async (tx) => {
      const { count } = await tx.folioRoutingRule.updateMany({
        where: { id: ruleId, propertyId: this.ctx.propertyId, removedAt: null },
        data: { removedAt: new Date() },
      });
      if (count !== 1) throw Problems.notFound('Routing rule');
      await this.audit.record(tx, {
        action: 'folio.routing_removed',
        entityType: 'folio_routing_rule',
        entityId: ruleId,
        propertyId: this.ctx.propertyId,
      });
    });
  }

  /**
   * Moves charges (with their taxes) to another folio as a TRANSFER pair. The source side
   * references the charge, so a charge moves once and a moved charge cannot be voided.
   */
  async transfer(
    folioId: string,
    input: { targetFolioId: string; lineIds: string[]; reason: string },
  ): Promise<Folio> {
    const { organizationId, propertyId, actorId } = this.ctx;
    return this.db.run(async (tx) => {
      const source = await this.folios.requireInTx(tx, folioId);
      const target = await tx.folio.findFirst({ where: { id: input.targetFolioId, propertyId } });
      if (!target || target.id === source.id) {
        throw Problems.validation([{ path: 'targetFolioId', message: 'Unknown or same folio' }]);
      }
      if (source.currency !== target.currency) {
        throw invalidState('The folios use different currencies.');
      }
      const businessDate = toDbDate(await businessDateOf(tx, propertyId));
      for (const lineId of [...new Set(input.lineIds)]) {
        const charge = await tx.folioLine.findFirst({
          where: { id: lineId, folioId, type: 'CHARGE' },
        });
        if (!charge) {
          throw Problems.validation([
            { path: 'lineIds', message: 'Only charges of this folio can move' },
          ]);
        }
        if (await tx.folioLine.count({ where: { reversesLineId: lineId } })) {
          throw invalidState(`"${charge.description}" was already voided or moved.`);
        }
        const taxes = await tx.folioLine.aggregate({
          where: { parentLineId: lineId },
          _sum: { amountMinor: true },
        });
        const gross = charge.amountMinor + (taxes._sum.amountMinor ?? 0n);
        const transferId = uuidv7();
        await tx.folioLine.create({
          data: {
            organizationId,
            propertyId,
            folioId,
            businessDate,
            type: 'TRANSFER',
            department: charge.department,
            description: `Moved to ${target.folioNo}: ${charge.description}`,
            amountMinor: -gross,
            currency: charge.currency,
            reversesLineId: charge.id,
            transferId,
            reason: input.reason,
            postedBy: actorId,
          },
        });
        await tx.folioLine.create({
          data: {
            organizationId,
            propertyId,
            folioId: target.id,
            businessDate,
            type: 'TRANSFER',
            department: charge.department,
            description: `From ${source.folioNo}: ${charge.description}`,
            amountMinor: gross,
            currency: charge.currency,
            transferId,
            reason: input.reason,
            postedBy: actorId,
          },
        });
      }
      await this.audit.record(tx, {
        action: 'folio.transferred',
        entityType: 'folio',
        entityId: folioId,
        propertyId,
        after: { targetFolioId: target.id, lineIds: input.lineIds, reason: input.reason },
      });
      return this.folios.loadInTx(tx, folioId);
    });
  }
}
