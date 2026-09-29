import { Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  attendanceCorrectionSchema,
  CLOCK_PHOTO_TYPES,
  attendanceDaySchema,
  type CreateShiftRequest,
  createShiftRequestSchema,
  type CreateShiftTemplateRequest,
  createShiftTemplateRequestSchema,
  type DateRangeQuery,
  dateRangeQuerySchema,
  type DecisionRequest,
  decisionRequestSchema,
  leaveDecisionResultSchema,
  type LeaveRequestListQuery,
  leaveRequestListQuerySchema,
  leaveRequestSchema,
  type PublishScheduleRequest,
  publishResultSchema,
  publishScheduleRequestSchema,
  type PunchRequest,
  punchRequestSchema,
  punchSchema,
  scheduleSchema,
  shiftSchema,
  shiftTemplateSchema,
  shiftWithWarningsSchema,
  type UpdateShiftRequest,
  updateShiftRequestSchema,
  listOf,
  type CorrectionListQuery,
  correctionListQuerySchema,
} from '@hotel/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendCsv } from '../../../common/download.js';
import { IfMatch, parseIfMatch } from '../../../common/etag.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../../common/zod.js';
import { AttendanceService } from './attendance.service.js';
import { LeaveService } from './leave.service.js';
import { PayrollService } from './payroll.service.js';
import { StaffingService } from './staffing.service.js';
import { ScheduleService } from './schedule.service.js';
import { TimeClockService } from './time-clock.service.js';

/** Property-level HR: clock, attendance, schedule, leave approvals, payroll export. */
@ApiTags('hr: property')
@Controller('properties/:propertyId')
export class PropertyHrController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly schedule: ScheduleService,
    private readonly leave: LeaveService,
    private readonly payroll: PayrollService,
    private readonly timeClock: TimeClockService,
    private readonly staffing: StaffingService,
  ) {}

  /** CSV of attendance and leave for payroll (decision D7). */
  @Get('payroll-export')
  @RequirePermission('payroll.export')
  async payrollExport(
    @Param('propertyId') propertyId: string,
    @ZodQuery(dateRangeQuerySchema) query: DateRangeQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const csv = await this.payroll.exportCsv(propertyId, query.from, query.to);
    return sendCsv(reply, `payroll-${query.from}-${query.to}.csv`, csv);
  }

  /** Punch type in the query; the body is the selfie taken now (ADR-0022). */
  @Post('attendance/punches')
  @RequirePermission('attendance.punch.own')
  @ApiConsumes(...CLOCK_PHOTO_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ZodResponse(201, punchSchema)
  punch(
    @Param('propertyId') propertyId: string,
    @ZodQuery(punchRequestSchema) query: PunchRequest,
    @Req() req: FastifyRequest,
  ) {
    return this.timeClock.webPunch(propertyId, query.type, req.headers['content-type'], req.body);
  }

  @Get('attendance')
  @RequirePermission('attendance.read')
  @ZodResponse(200, listOf(attendanceDaySchema))
  async attendanceDays(
    @Param('propertyId') propertyId: string,
    @ZodQuery(dateRangeQuerySchema) query: DateRangeQuery,
  ) {
    return { items: await this.attendance.propertyAttendance(propertyId, query.from, query.to) };
  }

  @Get('attendance/corrections')
  @RequirePermission('attendance.read')
  @ZodResponse(200, listOf(attendanceCorrectionSchema))
  async corrections(
    @Param('propertyId') propertyId: string,
    @ZodQuery(correctionListQuerySchema) query: CorrectionListQuery,
  ) {
    return { items: await this.attendance.corrections(propertyId, query.status) };
  }

  @Post('attendance/corrections/:correctionId/decision')
  @RequirePermission('attendance.manage')
  @HttpCode(200)
  @ZodResponse(200, attendanceCorrectionSchema)
  decideCorrection(
    @Param('propertyId') propertyId: string,
    @Param('correctionId') id: string,
    @IfMatch() ifMatch: string | undefined,
    @ZodBody(decisionRequestSchema) body: DecisionRequest,
  ) {
    return this.attendance.decideCorrection(propertyId, uuidParam(id), parseIfMatch(ifMatch), body);
  }

  @Get('shift-templates')
  @RequirePermission('schedule.read')
  @ZodResponse(200, listOf(shiftTemplateSchema))
  async templates(@Param('propertyId') propertyId: string) {
    return { items: await this.schedule.templates(propertyId) };
  }

  @Post('shift-templates')
  @RequirePermission('schedule.manage')
  @ZodResponse(201, listOf(shiftTemplateSchema))
  async createTemplate(
    @Param('propertyId') propertyId: string,
    @ZodBody(createShiftTemplateRequestSchema) body: CreateShiftTemplateRequest,
  ) {
    return { items: await this.schedule.createTemplate(propertyId, body) };
  }

  @Post('shift-templates/:templateId/archive')
  @RequirePermission('schedule.manage')
  @HttpCode(204)
  async archiveTemplate(@Param('propertyId') propertyId: string, @Param('templateId') id: string) {
    await this.schedule.archiveTemplate(propertyId, uuidParam(id));
  }

  @Get('schedule')
  @RequirePermission('schedule.read')
  @ZodResponse(200, scheduleSchema)
  scheduleView(
    @Param('propertyId') propertyId: string,
    @ZodQuery(dateRangeQuerySchema) query: DateRangeQuery,
  ) {
    return this.schedule.schedule(propertyId, query.from, query.to);
  }

  @Post('schedule/publish')
  @RequirePermission('schedule.manage')
  @HttpCode(200)
  @ZodResponse(200, publishResultSchema)
  async publish(
    @Param('propertyId') propertyId: string,
    @ZodBody(publishScheduleRequestSchema) body: PublishScheduleRequest,
  ) {
    const { published } = await this.schedule.publish(propertyId, body.from, body.to);
    // Understaffed windows left in the published range (ADR-0028).
    return { published, gaps: await this.staffing.coverage(propertyId, body.from, body.to) };
  }

  @Post('shifts')
  @RequirePermission('schedule.manage')
  @ZodResponse(201, shiftWithWarningsSchema)
  createShift(
    @Param('propertyId') propertyId: string,
    @ZodBody(createShiftRequestSchema) body: CreateShiftRequest,
  ) {
    return this.schedule.createShift(propertyId, body);
  }

  @Patch('shifts/:shiftId')
  @RequirePermission('schedule.manage')
  @ZodResponse(200, shiftWithWarningsSchema)
  updateShift(
    @Param('propertyId') propertyId: string,
    @Param('shiftId') id: string,
    @IfMatch() ifMatch: string | undefined,
    @ZodBody(updateShiftRequestSchema) body: UpdateShiftRequest,
  ) {
    return this.schedule.updateShift(propertyId, uuidParam(id), parseIfMatch(ifMatch), body);
  }

  @Post('shifts/:shiftId/cancel')
  @RequirePermission('schedule.manage')
  @HttpCode(200)
  @ZodResponse(200, shiftSchema)
  cancelShift(
    @Param('propertyId') propertyId: string,
    @Param('shiftId') id: string,
    @IfMatch() ifMatch: string | undefined,
  ) {
    return this.schedule.cancelShift(propertyId, uuidParam(id), parseIfMatch(ifMatch));
  }

  @Get('leave-requests')
  @RequirePermission('leave.read')
  @ZodResponse(200, listOf(leaveRequestSchema))
  async leaveRequests(
    @Param('propertyId') propertyId: string,
    @ZodQuery(leaveRequestListQuerySchema) query: LeaveRequestListQuery,
  ) {
    return { items: await this.leave.propertyRequests(propertyId, query) };
  }

  @Post('leave-requests/:leaveRequestId/decision')
  @RequirePermission('leave.approve')
  @HttpCode(200)
  @ZodResponse(200, leaveDecisionResultSchema)
  decideLeave(
    @Param('propertyId') propertyId: string,
    @Param('leaveRequestId') id: string,
    @IfMatch() ifMatch: string | undefined,
    @ZodBody(decisionRequestSchema) body: DecisionRequest,
  ) {
    return this.leave.decide(propertyId, uuidParam(id), parseIfMatch(ifMatch), body);
  }
}
