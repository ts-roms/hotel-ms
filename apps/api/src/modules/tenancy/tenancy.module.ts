import { Module } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service.js';
import { OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';
import { PropertiesController } from './properties.controller.js';
import { PropertiesService } from './properties.service.js';

/** Tenancy (blueprint §6.1): organization settings, feature flags and properties. */
@Module({
  controllers: [OrganizationController, PropertiesController],
  providers: [OrganizationService, PropertiesService, FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class TenancyModule {}
