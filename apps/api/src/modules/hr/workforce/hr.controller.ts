import { Controller, Get, HttpCode, Param, Patch, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CreateDepartmentRequest,
  createDepartmentRequestSchema,
  type CreateEmployeeRequest,
  createEmployeeRequestSchema,
  type CreatePositionRequest,
  createPositionRequestSchema,
  departmentSchema,
  type Employee,
  type EmployeeListQuery,
  employeeListQuerySchema,
  employeeSchema,
  employeeSummarySchema,
  type EndAssignmentRequest,
  endAssignmentRequestSchema,
  type LinkMembershipRequest,
  linkMembershipRequestSchema,
  type NewAssignment,
  newAssignmentSchema,
  type TerminateEmployeeRequest,
  terminateEmployeeRequestSchema,
  type UpdateDepartmentRequest,
  updateDepartmentRequestSchema,
  type UpdateEmployeeRequest,
  updateEmployeeRequestSchema,
  listOf,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { IfMatch, parseIfMatch, weakEtag } from '../../../common/etag.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../../common/zod.js';
import { PeopleService } from './people.service.js';

/** Organization-level HR: departments, positions, employees (blueprint §13). */
@ApiTags('hr')
@Controller()
export class HrController {
  constructor(private readonly people: PeopleService) {}

  @Get('departments')
  @RequirePermission('employee.read', 'any')
  @ZodResponse(200, listOf(departmentSchema))
  async departments() {
    return { items: await this.people.departments() };
  }

  @Post('departments')
  @RequirePermission('department.manage', 'organization')
  @ZodResponse(201, listOf(departmentSchema))
  async createDepartment(@ZodBody(createDepartmentRequestSchema) body: CreateDepartmentRequest) {
    return { items: await this.people.createDepartment(body) };
  }

  @Patch('departments/:departmentId')
  @RequirePermission('department.manage', 'organization')
  @ZodResponse(200, listOf(departmentSchema))
  async updateDepartment(
    @Param('departmentId') id: string,
    @ZodBody(updateDepartmentRequestSchema) body: UpdateDepartmentRequest,
  ) {
    return { items: await this.people.updateDepartment(uuidParam(id), body) };
  }

  @Post('positions')
  @RequirePermission('department.manage', 'organization')
  @ZodResponse(201, listOf(departmentSchema))
  async createPosition(@ZodBody(createPositionRequestSchema) body: CreatePositionRequest) {
    return { items: await this.people.createPosition(body) };
  }

  @Get('employees')
  @RequirePermission('employee.read', 'any')
  @ZodResponse(200, listOf(employeeSummarySchema))
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
    @IfMatch() ifMatch: string | undefined,
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
}
