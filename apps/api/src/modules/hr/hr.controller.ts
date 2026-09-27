import { Controller, Get, Headers, HttpCode, Param, Patch, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  attendanceCorrectionSchema,
  attendanceDaySchema,
  birthdaySchema,
  type CorrectionRequest,
  correctionRequestSchema,
  type CreateDepartmentRequest,
  createDepartmentRequestSchema,
  type CreateEmployeeRequest,
  createEmployeeRequestSchema,
  type CreateLeaveRequest,
  createLeaveRequestSchema,
  type CreateLeaveTypeRequest,
  createLeaveTypeRequestSchema,
  type CreatePositionRequest,
  createPositionRequestSchema,
  type CreateShiftRequest,
  createShiftRequestSchema,
  type CreateShiftTemplateRequest,
  createShiftTemplateRequestSchema,
  type DateRangeQuery,
  dateRangeQuerySchema,
  type DecisionRequest,
  decisionRequestSchema,
  departmentSchema,
  type Employee,
  employeeLeaveSchema,
  type EmployeeListQuery,
  employeeListQuerySchema,
  employeeSchema,
  employeeSummarySchema,
  type EndAssignmentRequest,
  endAssignmentRequestSchema,
  leaveDecisionResultSchema,
  type LeaveLedgerPostRequest,
  leaveLedgerPostRequestSchema,
  type LeaveRequestListQuery,
  leaveRequestListQuerySchema,
  leaveRequestSchema,
  leaveTypeSchema,
  type LinkMembershipRequest,
  linkMembershipRequestSchema,
  myEmployeeSchema,
  type NewAssignment,
  newAssignmentSchema,
  type PublishScheduleRequest,
  publishScheduleRequestSchema,
  type PunchRequest,
  punchRequestSchema,
  punchSchema,
  scheduleSchema,
  shiftSchema,
  shiftTemplateSchema,
  shiftWithWarningsSchema,
  type TerminateEmployeeRequest,
  terminateEmployeeRequestSchema,
  type UpdateDepartmentRequest,
  updateDepartmentRequestSchema,
  type UpdateEmployeeRequest,
  updateEmployeeRequestSchema,
  type UpdateLeaveTypeRequest,
  updateLeaveTypeRequestSchema,
  type UpdateShiftRequest,
  updateShiftRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseIfMatch, weakEtag } from '../../common/etag.js';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { AttendanceService } from './attendance.service.js';
import { LeaveService } from './leave.service.js';
import { PayrollService } from './payroll.service.js';
import { PeopleService } from './people.service.js';
import { ScheduleService } from './schedule.service.js';

const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

const correctionStatusQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
});

/** Organization-level HR: departments, employees, leave configuration (blueprint §13). */
@ApiTags('hr')
@Controller()
export class HrController {
  constructor(
    private readonly people: PeopleService,
    private readonly leave: LeaveService,
  ) {}

  @Get('departments')
  @RequirePermission('employee.read', 'any')
  @ZodResponse(200, items(departmentSchema))
  async departments() {
    return { items: await this.people.departments() };
  }

  @Post('departments')
  @RequirePermission('department.manage', 'organization')
  @ZodResponse(201, items(departmentSchema))
  async createDepartment(@ZodBody(createDepartmentRequestSchema) body: CreateDepartmentRequest) {
    return { items: await this.people.createDepartment(body) };
  }

  @Patch('departments/:departmentId')
  @RequirePermission('department.manage', 'organization')
  @ZodResponse(200, items(departmentSchema))
  async updateDepartment(
    @Param('departmentId') id: string,
    @ZodBody(updateDepartmentRequestSchema) body: UpdateDepartmentRequest,
  ) {
    return { items: await this.people.updateDepartment(uuidParam(id), body) };
  }

  @Post('positions')
  @RequirePermission('department.manage', 'organization')
  @ZodResponse(201, items(departmentSchema))
  async createPosition(@ZodBody(createPositionRequestSchema) body: CreatePositionRequest) {
    return { items: await this.people.createPosition(body) };
  }

  @Get('employees')
  @RequirePermission('employee.read', 'any')
  @ZodResponse(200, items(employeeSummarySchema))
  async employees(@ZodQuery(employeeListQuerySchema) query: EmployeeListQuery) {
    return { items: await this.people.list(query) };
  }

  private withEtag(reply: FastifyReply, employee: Employee): Employee {
    reply.header('etag', weakEtag(employee.version));
    return employee;
  }

  @Post('employees')
  @RequirePermission('employee.manage', 'any')
  @ZodResponse(201, employeeSchema)
  async createEmployee(
    @ZodBody(createEmployeeRequestSchema) body: CreateEmployeeRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.people.create(body));
  }

  @Get('employees/:employeeId')
  @RequirePermission('employee.read', 'any')
  @ZodResponse(200, employeeSchema)
  async employee(@Param('employeeId') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.withEtag(reply, await this.people.get(uuidParam(id)));
  }

  @Patch('employees/:employeeId')
  @RequirePermission('employee.manage', 'any')
  @ZodResponse(200, employeeSchema)
  async updateEmployee(
    @Param('employeeId') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateEmployeeRequestSchema) body: UpdateEmployeeRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(
      reply,
      await this.people.update(uuidParam(id), parseIfMatch(ifMatch), body),
    );
  }

  @Post('employees/:employeeId/assignments')
  @RequirePermission('employee.manage', 'any')
  @ZodResponse(201, employeeSchema)
  addAssignment(
    @Param('employeeId') id: string,
    @ZodBody(newAssignmentSchema) body: NewAssignment,
  ) {
    return this.people.addEmployeeAssignment(uuidParam(id), body);
  }

  @Post('employees/:employeeId/assignments/:assignmentId/end')
  @RequirePermission('employee.manage', 'any')
  @HttpCode(200)
  @ZodResponse(200, employeeSchema)
  endAssignment(
    @Param('employeeId') id: string,
    @Param('assignmentId') assignmentId: string,
    @ZodBody(endAssignmentRequestSchema) body: EndAssignmentRequest,
  ) {
    return this.people.endAssignment(uuidParam(id), uuidParam(assignmentId), body.endDate);
  }

  @Post('employees/:employeeId/terminate')
  @RequirePermission('employee.manage', 'any')
  @HttpCode(200)
  @ZodResponse(200, employeeSchema)
  terminate(
    @Param('employeeId') id: string,
    @ZodBody(terminateEmployeeRequestSchema) body: TerminateEmployeeRequest,
  ) {
    return this.people.terminate(uuidParam(id), body.terminatedOn);
  }

  @Put('employees/:employeeId/membership')
  @RequirePermission('employee.manage', 'organization')
  @ZodResponse(200, employeeSchema)
  linkMembership(
    @Param('employeeId') id: string,
    @ZodBody(linkMembershipRequestSchema) body: LinkMembershipRequest,
  ) {
    return this.people.linkMembership(uuidParam(id), body.membershipId);
  }

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
  @ZodResponse(200, items(leaveTypeSchema))
  async leaveTypes() {
    return { items: await this.leave.types() };
  }

  @Post('leave-types')
  @RequirePermission('leave.configure', 'organization')
  @ZodResponse(201, leaveTypeSchema)
  createLeaveType(@ZodBody(createLeaveTypeRequestSchema) body: CreateLeaveTypeRequest) {
    return this.leave.createType(body);
  }

  @Patch('leave-types/:leaveTypeId')
  @RequirePermission('leave.configure', 'organization')
  @ZodResponse(200, leaveTypeSchema)
  updateLeaveType(
    @Param('leaveTypeId') id: string,
    @ZodBody(updateLeaveTypeRequestSchema) body: UpdateLeaveTypeRequest,
  ) {
    return this.leave.updateType(uuidParam(id), body);
  }
}

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
  @ZodResponse(200, items(shiftSchema))
  async shifts(@ZodQuery(dateRangeQuerySchema) query: DateRangeQuery) {
    return { items: await this.schedule.myShifts(query.from, query.to) };
  }

  @Get('attendance')
  @RequirePermission('attendance.punch.own', 'any')
  @ZodResponse(200, items(attendanceDaySchema))
  async myAttendance(@ZodQuery(dateRangeQuerySchema) query: DateRangeQuery) {
    return { items: await this.attendance.myAttendance(query.from, query.to) };
  }

  @Get('attendance-corrections')
  @RequirePermission('attendance.punch.own', 'any')
  @ZodResponse(200, items(attendanceCorrectionSchema))
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

/** Property-level HR: clock, attendance, schedule, leave approvals, birthdays. */
@ApiTags('hr: property')
@Controller('properties/:propertyId')
export class PropertyHrController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly schedule: ScheduleService,
    private readonly leave: LeaveService,
    private readonly people: PeopleService,
    private readonly payroll: PayrollService,
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
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header(
      'content-disposition',
      `attachment; filename="payroll-${query.from}-${query.to}.csv"`,
    );
    reply.header('cache-control', 'no-store');
    return csv;
  }

  @Post('attendance/punches')
  @RequirePermission('attendance.punch.own')
  @ZodResponse(201, punchSchema)
  punch(@Param('propertyId') propertyId: string, @ZodBody(punchRequestSchema) body: PunchRequest) {
    return this.attendance.punch(propertyId, body.type);
  }

  @Get('attendance')
  @RequirePermission('attendance.read')
  @ZodResponse(200, items(attendanceDaySchema))
  async attendanceDays(
    @Param('propertyId') propertyId: string,
    @ZodQuery(dateRangeQuerySchema) query: DateRangeQuery,
  ) {
    return { items: await this.attendance.propertyAttendance(propertyId, query.from, query.to) };
  }

  @Get('attendance/corrections')
  @RequirePermission('attendance.read')
  @ZodResponse(200, items(attendanceCorrectionSchema))
  async corrections(
    @Param('propertyId') propertyId: string,
    @ZodQuery(correctionStatusQuery) query: z.infer<typeof correctionStatusQuery>,
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
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(decisionRequestSchema) body: DecisionRequest,
  ) {
    return this.attendance.decideCorrection(propertyId, uuidParam(id), parseIfMatch(ifMatch), body);
  }

  @Get('shift-templates')
  @RequirePermission('schedule.read')
  @ZodResponse(200, items(shiftTemplateSchema))
  async templates(@Param('propertyId') propertyId: string) {
    return { items: await this.schedule.templates(propertyId) };
  }

  @Post('shift-templates')
  @RequirePermission('schedule.manage')
  @ZodResponse(201, items(shiftTemplateSchema))
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
  @ZodResponse(200, z.object({ published: z.number().int() }))
  publish(
    @Param('propertyId') propertyId: string,
    @ZodBody(publishScheduleRequestSchema) body: PublishScheduleRequest,
  ) {
    return this.schedule.publish(propertyId, body.from, body.to);
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
    @Headers('if-match') ifMatch: string | undefined,
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
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.schedule.cancelShift(propertyId, uuidParam(id), parseIfMatch(ifMatch));
  }

  @Get('leave-requests')
  @RequirePermission('leave.read')
  @ZodResponse(200, items(leaveRequestSchema))
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
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(decisionRequestSchema) body: DecisionRequest,
  ) {
    return this.leave.decide(propertyId, uuidParam(id), parseIfMatch(ifMatch), body);
  }

  @Get('birthdays')
  @RequirePermission('birthday.read')
  @ZodResponse(200, items(birthdaySchema))
  async birthdays(@Param('propertyId') propertyId: string) {
    return { items: await this.people.birthdays(propertyId) };
  }
}
