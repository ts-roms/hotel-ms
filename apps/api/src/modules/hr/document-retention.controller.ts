import { Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type DocumentRetention, documentRetentionSchema } from '@hotel/contracts';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { EmployeeDocumentsService } from './documents.service.js';

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
