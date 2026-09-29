import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  folioDocumentSchema,
  type IssueDocumentRequest,
  issueDocumentRequestSchema,
  listOf,
} from '@hotel/contracts';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { FolioDocumentsService } from './folio-documents.service.js';

/** Invoices and receipts issued from a folio. */
@ApiTags('finance')
@Controller('properties/:propertyId')
export class FolioDocumentsController {
  constructor(private readonly documents: FolioDocumentsService) {}

  @Post('folios/:folioId/documents')
  @RequirePermission('invoice.issue')
  @ZodResponse(201, folioDocumentSchema)
  issue(
    @Param('propertyId') propertyId: string,
    @Param('folioId') folioId: string,
    @ZodBody(issueDocumentRequestSchema) body: IssueDocumentRequest,
  ) {
    return this.documents.issue(propertyId, uuidParam(folioId), body);
  }

  @Get('folios/:folioId/documents')
  @RequirePermission('folio.read')
  @ZodResponse(200, listOf(folioDocumentSchema))
  async documentList(@Param('propertyId') propertyId: string, @Param('folioId') folioId: string) {
    return { items: await this.documents.list(propertyId, uuidParam(folioId)) };
  }

  @Get('documents/:documentId')
  @RequirePermission('folio.read')
  @ZodResponse(200, folioDocumentSchema)
  document(@Param('propertyId') propertyId: string, @Param('documentId') id: string) {
    return this.documents.get(propertyId, uuidParam(id));
  }
}
