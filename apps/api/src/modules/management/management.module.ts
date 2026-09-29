import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module.js';
import { ManagementController } from './management.controller.js';
import { ManagementService } from './management.service.js';
import { PropertyReportsController } from './property-reports.controller.js';
import { SearchService } from './search.service.js';

/** Insights (blueprint §6.1, ADR-0025): dashboards, property reports and global search. */
@Module({
  imports: [HrModule],
  controllers: [ManagementController, PropertyReportsController],
  providers: [ManagementService, SearchService],
})
export class ManagementModule {}
