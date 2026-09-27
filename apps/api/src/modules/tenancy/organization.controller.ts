import { Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type FeatureFlag,
  featureFlagSchema,
  type SetFeatureFlagRequest,
  setFeatureFlagRequestSchema,
} from '@hotel/contracts';
import { z } from 'zod';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/request-context.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { TenantDb } from '../../infrastructure/database.js';
import { Problems } from '../../common/problem.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { AuditService } from '../audit/audit.service.js';

@ApiTags('organization')
@Controller('organization')
export class OrganizationController {
  constructor(
    private readonly db: TenantDb,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
  ) {}

  /** The caller's active organization. There is deliberately no /organizations/:id. */
  @Get()
  @RequirePermission('organization.read', 'any')
  async current() {
    const org = await this.db.run((tx) =>
      tx.organization.findUnique({ where: { id: this.cls.get('organizationId')! } }),
    );
    if (!org) throw Problems.notFound('Organization');
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      defaultLocale: org.defaultLocale,
      defaultCurrency: org.defaultCurrency,
      defaultTimezone: org.defaultTimezone,
    };
  }

  /** Every platform flag with its effective value for this organization. */
  @Get('feature-flags')
  @RequirePermission('feature_flag.manage', 'organization')
  @ZodResponse(200, z.object({ items: z.array(featureFlagSchema) }))
  async featureFlags(): Promise<{ items: FeatureFlag[] }> {
    const items = await this.db.run(async (tx) => {
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
    return { items };
  }

  @Put('feature-flags/:flagKey')
  @RequirePermission('feature_flag.manage', 'organization')
  @ZodResponse(200, featureFlagSchema)
  async setFeatureFlag(
    @Param('flagKey') flagKey: string,
    @ZodBody(setFeatureFlagRequestSchema) body: SetFeatureFlagRequest,
  ): Promise<FeatureFlag> {
    const organizationId = this.cls.get('organizationId')!;
    return this.db.run(async (tx) => {
      const definition = await tx.featureFlagDefinition.findUnique({ where: { key: flagKey } });
      if (!definition) throw Problems.notFound('Feature flag');
      const before = await tx.organizationFeatureFlag.findUnique({
        where: { organizationId_flagKey: { organizationId, flagKey } },
      });
      await tx.organizationFeatureFlag.upsert({
        where: { organizationId_flagKey: { organizationId, flagKey } },
        create: {
          organizationId,
          flagKey,
          enabled: body.enabled,
          updatedBy: this.cls.get('identityId') ?? null,
        },
        update: { enabled: body.enabled, updatedBy: this.cls.get('identityId') ?? null },
      });
      await this.audit.record(tx, {
        action: 'feature_flag.set',
        entityType: 'feature_flag',
        entityId: null,
        before: { flagKey, enabled: before?.enabled ?? definition.defaultEnabled },
        after: { flagKey, enabled: body.enabled },
      });
      return { key: definition.key, description: definition.description, enabled: body.enabled };
    });
  }
}
