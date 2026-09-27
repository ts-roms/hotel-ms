import { Controller, Delete, Get, HttpCode, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type DocumentRetention,
  documentRetentionSchema,
  EMPLOYEE_DOCUMENT_TYPES,
  employeeDocumentSchema,
  type UploadEmployeeDocumentQuery,
  uploadEmployeeDocumentQuerySchema,
} from '@hotel/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { EmployeeDocumentsService } from './documents.service.js';

/** RFC 6266 Content-Disposition: an ASCII fallback plus the exact UTF-8 name. */
export function attachmentHeader(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Employee documents (ADR-0019). The upload body is the file itself. */
@ApiTags('hr')
@Controller('employees/:employeeId/documents')
export class EmployeeDocumentsController {
  constructor(private readonly documents: EmployeeDocumentsService) {}

  @Get()
  @RequirePermission('employee.documents', 'any')
  @ZodResponse(200, z.object({ items: z.array(employeeDocumentSchema) }))
  async list(@Param('employeeId') employeeId: string) {
    return { items: await this.documents.list(uuidParam(employeeId)) };
  }

  @Post()
  @RequirePermission('employee.documents', 'any')
  @ApiConsumes(...EMPLOYEE_DOCUMENT_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ZodResponse(201, employeeDocumentSchema)
  upload(
    @Param('employeeId') employeeId: string,
    @ZodQuery(uploadEmployeeDocumentQuerySchema) query: UploadEmployeeDocumentQuery,
    @Req() req: FastifyRequest,
  ) {
    return this.documents.upload(
      uuidParam(employeeId),
      req.headers['content-type'],
      req.body,
      query,
    );
  }

  @Get(':documentId/content')
  @RequirePermission('employee.documents', 'any')
  @ApiProduces(...EMPLOYEE_DOCUMENT_TYPES)
  async download(
    @Param('employeeId') employeeId: string,
    @Param('documentId') documentId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { document, stream } = await this.documents.open(
      uuidParam(employeeId),
      uuidParam(documentId),
    );
    await reply
      .header('content-type', document.contentType)
      .header('content-length', String(document.sizeBytes))
      .header('content-disposition', attachmentHeader(document.fileName))
      .header('cache-control', 'private, no-store')
      // Never rendered as a page in our origin, whatever the file contains.
      .header('content-security-policy', "sandbox; default-src 'none'")
      .send(stream);
  }

  @Delete(':documentId')
  @RequirePermission('employee.documents', 'any')
  @HttpCode(204)
  async remove(
    @Param('employeeId') employeeId: string,
    @Param('documentId') documentId: string,
  ): Promise<void> {
    await this.documents.remove(uuidParam(employeeId), uuidParam(documentId));
  }
}

/** Retention rules for employee documents, per category (ADR-0021). */
@ApiTags('hr')
@Controller('document-retention')
export class DocumentRetentionController {
  constructor(private readonly documents: EmployeeDocumentsService) {}

  @Get()
  @RequirePermission('employee.documents', 'organization')
  @ZodResponse(200, documentRetentionSchema)
  get() {
    return this.documents.retention();
  }

  @Put()
  @RequirePermission('employee.documents', 'organization')
  @ZodResponse(200, documentRetentionSchema)
  set(@ZodBody(documentRetentionSchema) body: DocumentRetention) {
    return this.documents.setRetention(body);
  }
}
