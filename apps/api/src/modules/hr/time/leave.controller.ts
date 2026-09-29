import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CreateLeaveTypeRequest,
  createLeaveTypeRequestSchema,
  employeeLeaveSchema,
  type LeaveLedgerPostRequest,
  leaveLedgerPostRequestSchema,
  leaveTypeSchema,
  type UpdateLeaveTypeRequest,
  updateLeaveTypeRequestSchema,
  listOf,
} from '@hotel/contracts';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { LeaveTypesService } from './leave-types.service.js';
import { LeaveService } from './leave.service.js';

/** Organization-level leave: employee balances and ledger entries, leave types. */
@ApiTags('hr')
@Controller()
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly types: LeaveTypesService,
  ) {}

  @Get('employees/:employeeId/leave')
  @RequirePermission('leave.read', 'any')
  @ZodResponse(200, employeeLeaveSchema)
  employeeLeave(@Param('employeeId') id: string) {
    return this.leave.employeeLeave(uuidParam(id));
  }

  @Post('employees/:employeeId/leave/entries')
  @RequirePermission('leave.manage', 'any')
  @ZodResponse(201, employeeLeaveSchema)
  postLedger(
    @Param('employeeId') id: string,
    @ZodBody(leaveLedgerPostRequestSchema) body: LeaveLedgerPostRequest,
  ) {
    return this.leave.postLedger(uuidParam(id), body);
  }

  @Get('leave-types')
  @RequirePermission('leave.request.own', 'any')
  @ZodResponse(200, listOf(leaveTypeSchema))
  async leaveTypes() {
    return { items: await this.types.types() };
  }

  @Post('leave-types')
  @RequirePermission('leave.configure', 'organization')
  @ZodResponse(201, leaveTypeSchema)
  createLeaveType(@ZodBody(createLeaveTypeRequestSchema) body: CreateLeaveTypeRequest) {
    return this.types.createType(body);
  }

  @Patch('leave-types/:leaveTypeId')
  @RequirePermission('leave.configure', 'organization')
  @ZodResponse(200, leaveTypeSchema)
  updateLeaveType(
    @Param('leaveTypeId') id: string,
    @ZodBody(updateLeaveTypeRequestSchema) body: UpdateLeaveTypeRequest,
  ) {
    return this.types.updateType(uuidParam(id), body);
  }
}
