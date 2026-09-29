import { Injectable } from '@nestjs/common';
import type { FeatureFlag, FeatureFlagKey } from '@hotel/contracts';
import type { Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * Feature flags per organization. The platform defines the flags and their defaults
 * (FEATURE_FLAGS in @hotel/contracts, synced into feature_flag_definitions); an
 * organization's override, if any, wins over the default.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(
    private readonly db: TenantDb,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
  ) {}

  /** Whether a flag is on for the current organization, in the caller's transaction. */
  async isEnabledInTx(tx: Tx, key: FeatureFlagKey): Promise<boolean> {
    const definition = await tx.featureFlagDefinition.findUnique({ where: { key } });
    if (!definition) return false;
    const override = await tx.organizationFeatureFlag.findUnique({
      where: {
        organizationId_flagKey: { organizationId: this.cls.get('organizationId')!, flagKey: key },
      },
    });
    return override?.enabled ?? definition.defaultEnabled;
  }

  /** Every platform flag with its effective value for this organization. */
  async list(): Promise<FeatureFlag[]> {
    return this.db.run(async (tx) => {
      // Sequential: one transaction is one connection.
      const definitions = await tx.featureFlagDefinition.findMany({ orderBy: { key: 'asc' } });
      const overrides = await tx.organizationFeatureFlag.findMany();
      const enabled = new Map(overrides.map((o) => [o.flagKey, o.enabled]));
      return definitions.map((d) => ({
        key: d.key,
        description: d.description,
        enabled: enabled.get(d.key) ?? d.defaultEnabled,
      }));
    });
  }

  async set(flagKey: string, enabled: boolean): Promise<FeatureFlag> {
    const organizationId = this.cls.get('organizationId')!;
    const updatedBy = this.cls.get('identityId') ?? null;
    return this.db.run(async (tx) => {
      const definition = await tx.featureFlagDefinition.findUnique({ where: { key: flagKey } });
      if (!definition) throw Problems.notFound('Feature flag');
      const before = await tx.organizationFeatureFlag.findUnique({
        where: { organizationId_flagKey: { organizationId, flagKey } },
      });
      await tx.organizationFeatureFlag.upsert({
        where: { organizationId_flagKey: { organizationId, flagKey } },
        create: { organizationId, flagKey, enabled, updatedBy },
        update: { enabled, updatedBy },
      });
      await this.audit.record(tx, {
        action: 'feature_flag.set',
        entityType: 'feature_flag',
        entityId: null,
        before: { flagKey, enabled: before?.enabled ?? definition.defaultEnabled },
        after: { flagKey, enabled },
      });
      return { key: definition.key, description: definition.description, enabled };
    });
  }
}
