import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type DailyReportQuery,
  dailyReportQuerySchema,
  dailyReportSchema,
  listOf,
  reconciliationRunSchema,
  reconciliationSchema,
} from '@hotel/contracts';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodQuery, ZodResponse } from '../../../common/zod.js';
import { FinanceReportsService } from './finance-reports.service.js';

/** The daily finance report and payment reconciliation. */
@ApiTags('finance')
@Controller('properties/:propertyId')
export class FinanceReportsController {
  constructor(private readonly reports: FinanceReportsService) {}

  @Get('reports/daily')
  @RequirePermission('finance.report.read')
  @ZodResponse(200, dailyReportSchema)
  daily(
    @Param('propertyId') propertyId: string,
    @ZodQuery(dailyReportQuerySchema) query: DailyReportQuery,
  ) {
    return this.reports.daily(propertyId, query.date);
  }

  @Get('reports/reconciliation-runs')
  @RequirePermission('finance.report.read')
  @ZodResponse(200, listOf(reconciliationRunSchema))
  async reconciliationRuns(@Param('propertyId') propertyId: string) {
    return { items: await this.reports.runs(propertyId) };
  }

  @Get('reports/reconciliation')
  @RequirePermission('finance.report.read')
  @ZodResponse(200, reconciliationSchema)
  reconciliation(@Param('propertyId') propertyId: string) {
    return this.reports.reconciliation(propertyId);
  }
}
