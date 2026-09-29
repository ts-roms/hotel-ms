import { Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AssignHousekeepingTaskRequest,
  assignHousekeepingTaskRequestSchema,
  type CreateHousekeepingTaskRequest,
  createHousekeepingTaskRequestSchema,
  housekeepingBoardSchema,
  housekeepingTaskSchema,
  type SetHousekeepingStatusRequest,
  setHousekeepingStatusRequestSchema,
  staffRefSchema,
} from '@hotel/contracts';
import { z } from 'zod';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { HousekeepingService } from './housekeeping.service.js';

/** The housekeeping board, room cleaning status and cleaning tasks. */
@ApiTags('housekeeping')
@Controller('properties/:propertyId')
export class HousekeepingController {
  constructor(private readonly housekeeping: HousekeepingService) {}

  @Get('housekeeping')
  @RequirePermission('housekeeping.read')
  @ZodResponse(200, housekeepingBoardSchema)
  housekeepingBoard() {
    return this.housekeeping.board();
  }

  @Put('rooms/:roomId/housekeeping-status')
  @RequirePermission('housekeeping.update')
  @ZodResponse(200, housekeepingBoardSchema.shape.rooms.element)
  setHousekeepingStatus(
    @Param('roomId') roomId: string,
    @ZodBody(setHousekeepingStatusRequestSchema) body: SetHousekeepingStatusRequest,
  ) {
    return this.housekeeping.setStatus(uuidParam(roomId), body);
  }

  @Get('housekeeping/staff')
  @RequirePermission('housekeeping.assign')
  @ZodResponse(200, z.array(staffRefSchema))
  housekeepingStaff() {
    return this.housekeeping.staff();
  }

  @Post('housekeeping/tasks')
  @RequirePermission('housekeeping.assign')
  @HttpCode(201)
  @ZodResponse(201, housekeepingTaskSchema)
  createTask(@ZodBody(createHousekeepingTaskRequestSchema) body: CreateHousekeepingTaskRequest) {
    return this.housekeeping.createTask(body);
  }

  @Put('housekeeping/tasks/:taskId/assignee')
  @RequirePermission('housekeeping.assign')
  @ZodResponse(200, housekeepingTaskSchema)
  assignTask(
    @Param('taskId') taskId: string,
    @ZodBody(assignHousekeepingTaskRequestSchema) body: AssignHousekeepingTaskRequest,
  ) {
    return this.housekeeping.assignTask(uuidParam(taskId), body.assignedMembershipId);
  }
}
