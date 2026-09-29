import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  compensationHistorySchema,
  type CreateCompensationRequest,
  createCompensationRequestSchema,
  type CreatePerformanceReviewRequest,
  createPerformanceReviewRequestSchema,
  type CreateTrainingRequest,
  createTrainingRequestSchema,
  performanceReviewSchema,
  trainingRecordSchema,
  listOf,
} from '@hotel/contracts';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { ProfileRecordsService } from './profile-records.service.js';

/** Pay, training and performance records on an employee's file (ADR-0028). */
@ApiTags('hr')
@Controller('employees/:employeeId')
export class EmployeeRecordsController {
  constructor(private readonly records: ProfileRecordsService) {}

  @Get('compensation')
  @RequirePermission('employee.compensation', 'any')
  @ZodResponse(200, compensationHistorySchema)
  compensation(@Param('employeeId') id: string) {
    return this.records.compensation(uuidParam(id));
  }

  @Post('compensation')
  @RequirePermission('employee.compensation', 'any')
  @ZodResponse(201, compensationHistorySchema)
  addCompensation(
    @Param('employeeId') id: string,
    @ZodBody(createCompensationRequestSchema) body: CreateCompensationRequest,
  ) {
    return this.records.addCompensation(uuidParam(id), body);
  }

  @Get('training')
  @RequirePermission('employee.read', 'any')
  @ZodResponse(200, listOf(trainingRecordSchema))
  async trainings(@Param('employeeId') id: string) {
    return { items: await this.records.trainings(uuidParam(id)) };
  }

  @Post('training')
  @RequirePermission('employee.manage', 'any')
  @ZodResponse(201, listOf(trainingRecordSchema))
  async addTraining(
    @Param('employeeId') id: string,
    @ZodBody(createTrainingRequestSchema) body: CreateTrainingRequest,
  ) {
    return { items: await this.records.addTraining(uuidParam(id), body) };
  }

  @Delete('training/:recordId')
  @RequirePermission('employee.manage', 'any')
  @HttpCode(204)
  async removeTraining(@Param('employeeId') id: string, @Param('recordId') recordId: string) {
    await this.records.removeTraining(uuidParam(id), uuidParam(recordId));
  }

  @Get('reviews')
  @RequirePermission('employee.performance', 'any')
  @ZodResponse(200, listOf(performanceReviewSchema))
  async reviews(@Param('employeeId') id: string) {
    return { items: await this.records.reviews(uuidParam(id)) };
  }

  @Post('reviews')
  @RequirePermission('employee.performance', 'any')
  @ZodResponse(201, listOf(performanceReviewSchema))
  async addReview(
    @Param('employeeId') id: string,
    @ZodBody(createPerformanceReviewRequestSchema) body: CreatePerformanceReviewRequest,
  ) {
    return { items: await this.records.addReview(uuidParam(id), body) };
  }
}
