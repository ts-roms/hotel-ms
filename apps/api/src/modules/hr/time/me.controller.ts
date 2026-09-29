import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  attendanceCorrectionSchema,
  attendanceDaySchema,
  type CorrectionRequest,
  correctionRequestSchema,
  type CreateLeaveRequest,
  createLeaveRequestSchema,
  type DateRangeQuery,
  dateRangeQuerySchema,
  employeeLeaveSchema,
  leaveRequestSchema,
  myEmployeeSchema,
  shiftSchema,
  listOf,
} from '@hotel/contracts';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../../common/zod.js';
import { AttendanceService } from './attendance.service.js';
import { LeaveService } from './leave.service.js';
import { ScheduleService } from './schedule.service.js';

/** Self service: the caller's own employee record, time and leave. */
@ApiTags('hr: self service')
@Controller('me')
export class MeController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly schedule: ScheduleService,
    private readonly leave: LeaveService,
  ) {}

  @Get('employee')
  // Any staff member may ask whether they have an employee record.
  @RequirePermission('property.read', 'any')
  @ZodResponse(200, myEmployeeSchema)
  employee() {
    return this.attendance.me();
  }

  @Get('shifts')
  @RequirePermission('schedule.read.own', 'any')
  @ZodResponse(200, listOf(shiftSchema))
  async shifts(@ZodQuery(dateRangeQuerySchema) query: DateRangeQuery) {
    return { items: await this.schedule.myShifts(query.from, query.to) };
  }

  @Get('attendance')
  @RequirePermission('attendance.punch.own', 'any')
  @ZodResponse(200, listOf(attendanceDaySchema))
  async myAttendance(@ZodQuery(dateRangeQuerySchema) query: DateRangeQuery) {
    return { items: await this.attendance.myAttendance(query.from, query.to) };
  }

  @Get('attendance-corrections')
  @RequirePermission('attendance.punch.own', 'any')
  @ZodResponse(200, listOf(attendanceCorrectionSchema))
  async corrections() {
    return { items: await this.attendance.myCorrections() };
  }

  @Post('attendance-corrections')
  @RequirePermission('attendance.punch.own', 'any')
  @ZodResponse(201, attendanceCorrectionSchema)
  requestCorrection(@ZodBody(correctionRequestSchema) body: CorrectionRequest) {
    return this.attendance.requestCorrection(body);
  }

  @Get('leave')
  @RequirePermission('leave.request.own', 'any')
  @ZodResponse(200, employeeLeaveSchema)
  myLeave() {
    return this.leave.myLeave();
  }

  @Post('leave-requests')
  @RequirePermission('leave.request.own', 'any')
  @ZodResponse(201, leaveRequestSchema)
  requestLeave(@ZodBody(createLeaveRequestSchema) body: CreateLeaveRequest) {
    return this.leave.request(body);
  }

  @Post('leave-requests/:leaveRequestId/cancel')
  @RequirePermission('leave.request.own', 'any')
  @HttpCode(200)
  @ZodResponse(200, leaveRequestSchema)
  cancelLeave(@Param('leaveRequestId') id: string) {
    return this.leave.cancelMine(uuidParam(id));
  }
}
