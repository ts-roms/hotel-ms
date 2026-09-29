import { Controller, Get, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type ServiceRequest,
  type ServiceRequestListQuery,
  serviceRequestListQuerySchema,
  serviceRequestSchema,
  type ServiceRequestUpdate,
  serviceRequestUpdateSchema,
  type StaffServiceRequestCreate,
  staffServiceRequestCreateSchema,
  staffRefSchema,
  listOf,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { IfMatch, parseIfMatch, weakEtag } from '../../../common/etag.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../../common/zod.js';
import { ServiceRequestsService } from './service-requests.service.js';

const serviceRequestList = listOf(serviceRequestSchema);
const etag = (r: ServiceRequest) => weakEtag(r.version);

/** The staff side of guest service requests: the queue, assignment and progress. */
@ApiTags('guest service')
@Controller('properties/:propertyId')
export class ServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @Get('service-requests')
  @RequirePermission('guest_service.read')
  @ZodResponse(200, serviceRequestList)
  async list(@ZodQuery(serviceRequestListQuerySchema) query: ServiceRequestListQuery) {
    return { items: await this.requests.list(query) };
  }

  @Post('service-requests')
  @RequirePermission('guest_service.update')
  @HttpCode(201)
  @ZodResponse(201, serviceRequestSchema)
  async create(
    @ZodBody(staffServiceRequestCreateSchema) body: StaffServiceRequestCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const created = await this.requests.staffCreate(body);
    reply.header('etag', etag(created));
    return created;
  }

  @Get('service-requests/assignees')
  @RequirePermission('guest_service.update')
  @ZodResponse(200, listOf(staffRefSchema))
  async assignees() {
    return { items: await this.requests.staff() };
  }

  @Get('service-requests/:requestId')
  @RequirePermission('guest_service.read')
  @ZodResponse(200, serviceRequestSchema)
  async get(
    @Param('requestId') requestId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const request = await this.requests.get(uuidParam(requestId));
    reply.header('etag', etag(request));
    return request;
  }

  @Patch('service-requests/:requestId')
  @RequirePermission('guest_service.update')
  @ZodResponse(200, serviceRequestSchema)
  async update(
    @Param('requestId') requestId: string,
    @IfMatch() ifMatch: string | undefined,
    @ZodBody(serviceRequestUpdateSchema) body: ServiceRequestUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const updated = await this.requests.update(uuidParam(requestId), body, parseIfMatch(ifMatch));
    reply.header('etag', etag(updated));
    return updated;
  }
}
