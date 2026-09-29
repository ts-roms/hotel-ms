import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CancelSeriesRequest,
  cancelSeriesRequestSchema,
  type CoverageQuery,
  coverageGapSchema,
  coverageQuerySchema,
  type CreateRecurringShiftsRequest,
  createRecurringShiftsRequestSchema,
  type CreateStaffingRequirementRequest,
  createStaffingRequirementRequestSchema,
  recurringShiftsResultSchema,
  staffingRequirementSchema,
} from '@hotel/contracts';
import { z } from 'zod';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../../common/zod.js';
import { ScheduleService } from './schedule.service.js';
import { StaffingService } from './staffing.service.js';

const items = <T extends z.ZodType>(schema: T) => z.object({ items: z.array(schema) });

/** Recurring shifts, minimum staffing and coverage of a property's schedule (ADR-0028). */
@ApiTags('hr')
@Controller('properties/:propertyId')
export class StaffingController {
  constructor(
    private readonly schedule: ScheduleService,
    private readonly staffing: StaffingService,
  ) {}

  @Post('shifts/recurring')
  @RequirePermission('schedule.manage')
  @ZodResponse(201, recurringShiftsResultSchema)
  recurring(
    @Param('propertyId') propertyId: string,
    @ZodBody(createRecurringShiftsRequestSchema) body: CreateRecurringShiftsRequest,
  ) {
    return this.schedule.createRecurring(propertyId, body);
  }

  @Post('shift-series/:seriesId/cancel')
  @RequirePermission('schedule.manage')
  @HttpCode(200)
  @ZodResponse(200, z.object({ cancelled: z.number().int() }))
  cancelSeries(
    @Param('propertyId') propertyId: string,
    @Param('seriesId') seriesId: string,
    @ZodBody(cancelSeriesRequestSchema) body: CancelSeriesRequest,
  ) {
    return this.schedule.cancelSeries(
      propertyId,
      uuidParam(seriesId),
      body.fromDate,
      body.employeeId,
    );
  }

  @Get('staffing-requirements')
  @RequirePermission('schedule.read')
  @ZodResponse(200, items(staffingRequirementSchema))
  async requirements(@Param('propertyId') propertyId: string) {
    return { items: await this.staffing.requirements(propertyId) };
  }

  @Post('staffing-requirements')
  @RequirePermission('schedule.manage')
  @ZodResponse(201, items(staffingRequirementSchema))
  async createRequirement(
    @Param('propertyId') propertyId: string,
    @ZodBody(createStaffingRequirementRequestSchema) body: CreateStaffingRequirementRequest,
  ) {
    return { items: await this.staffing.create(propertyId, body) };
  }

  @Post('staffing-requirements/:requirementId/archive')
  @RequirePermission('schedule.manage')
  @HttpCode(204)
  async archiveRequirement(
    @Param('propertyId') propertyId: string,
    @Param('requirementId') id: string,
  ) {
    await this.staffing.archive(propertyId, uuidParam(id));
  }

  @Get('schedule/coverage')
  @RequirePermission('schedule.read')
  @ZodResponse(200, items(coverageGapSchema))
  async coverage(
    @Param('propertyId') propertyId: string,
    @ZodQuery(coverageQuerySchema) query: CoverageQuery,
  ) {
    return { items: await this.staffing.coverage(propertyId, query.from, query.to) };
  }
}
