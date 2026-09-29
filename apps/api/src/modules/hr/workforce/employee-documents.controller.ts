import { Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  EMPLOYEE_DOCUMENT_TYPES,
  employeeDocumentSchema,
  type UploadEmployeeDocumentQuery,
  uploadEmployeeDocumentQuerySchema,
  listOf,
} from '@hotel/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { attachmentHeader } from '../../../common/download.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodQuery, ZodResponse } from '../../../common/zod.js';
import { EmployeeDocumentsService } from './employee-documents.service.js';

/** Employee documents (ADR-0019). The upload body is the file itself. */
@ApiTags('hr')
@Controller('employees/:employeeId/documents')
export class EmployeeDocumentsController {
  constructor(private readonly documents: EmployeeDocumentsService) {}

  @Get()
  @RequirePermission('employee.documents', 'any')
  @ZodResponse(200, listOf(employeeDocumentSchema))
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
