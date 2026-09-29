import { Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type FeatureFlag,
  featureFlagSchema,
  type SetFeatureFlagRequest,
  setFeatureFlagRequestSchema,
  listOf,
} from '@hotel/contracts';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { FeatureFlagsService } from './feature-flags.service.js';
import { OrganizationService } from './organization.service.js';

@ApiTags('organization')
@Controller('organization')
export class OrganizationController {
  constructor(
    private readonly organization: OrganizationService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /** The caller's active organization. There is deliberately no /organizations/:id. */
  @Get()
  @RequirePermission('organization.read', 'any')
  current() {
    return this.organization.current();
  }

  /** Every platform flag with its effective value for this organization. */
  @Get('feature-flags')
  @RequirePermission('feature_flag.manage', 'organization')
  @ZodResponse(200, listOf(featureFlagSchema))
  async featureFlags(): Promise<{ items: FeatureFlag[] }> {
    return { items: await this.flags.list() };
  }

  @Put('feature-flags/:flagKey')
  @RequirePermission('feature_flag.manage', 'organization')
  @ZodResponse(200, featureFlagSchema)
  setFeatureFlag(
    @Param('flagKey') flagKey: string,
    @ZodBody(setFeatureFlagRequestSchema) body: SetFeatureFlagRequest,
  ): Promise<FeatureFlag> {
    return this.flags.set(flagKey, body.enabled);
  }
}
