import { Controller, Get, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CreatePropertyRequest,
  createPropertyRequestSchema,
  cursorPage,
  type CursorPageQuery,
  cursorPageQuerySchema,
  type Property,
  propertySchema,
  type UpdatePropertyRequest,
  updatePropertyRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { IfMatch, parseIfMatch, weakEtag } from '../../common/etag.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { PropertiesService } from './properties.service.js';

const etag = (p: Property) => weakEtag(p.version);

@ApiTags('properties')
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  @RequirePermission('property.read', 'any')
  @ZodResponse(200, cursorPage(propertySchema), 'Properties the caller may read')
  list(@ZodQuery(cursorPageQuerySchema) query: CursorPageQuery) {
    return this.properties.list(query);
  }

  @Post()
  @RequirePermission('property.create', 'organization')
  @HttpCode(201)
  @ZodResponse(201, propertySchema)
  async create(
    @ZodBody(createPropertyRequestSchema) body: CreatePropertyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Property> {
    const property = await this.properties.create(body);
    reply.header('etag', etag(property));
    return property;
  }

  @Get(':propertyId')
  @RequirePermission('property.read')
  @ZodResponse(200, propertySchema)
  async get(
    @Param('propertyId') propertyId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Property> {
    const property = await this.properties.get(propertyId);
    reply.header('etag', etag(property));
    return property;
  }

  @Patch(':propertyId')
  @RequirePermission('property.update')
  @ZodResponse(200, propertySchema)
  async update(
    @Param('propertyId') propertyId: string,
    @IfMatch() ifMatch: string | undefined,
    @ZodBody(updatePropertyRequestSchema) body: UpdatePropertyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Property> {
    const property = await this.properties.update(propertyId, parseIfMatch(ifMatch), body);
    reply.header('etag', etag(property));
    return property;
  }
}
