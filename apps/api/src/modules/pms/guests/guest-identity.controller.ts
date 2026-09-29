import { Controller, Get, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  identityDocumentListQuerySchema,
  type IdentityDocumentListQuery,
  identityDocumentSchema,
  type IdentityReview,
  identityReviewSchema,
  listOf,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { parseIfMatch } from '../../../common/etag.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../../common/zod.js';
import { GuestIdentityService } from './guest-identity.service.js';

/** The front desk's review of the ID documents guests upload. */
@ApiTags('guests')
@Controller('properties/:propertyId')
export class GuestIdentityController {
  constructor(private readonly identity: GuestIdentityService) {}

  @Get('guest-ids')
  @RequirePermission('guest.identity.review')
  @ZodResponse(200, listOf(identityDocumentSchema))
  async listIds(
    @Param('propertyId') propertyId: string,
    @ZodQuery(identityDocumentListQuerySchema) query: IdentityDocumentListQuery,
  ) {
    return { items: await this.identity.list(propertyId, query) };
  }

  @Get('guest-ids/:documentId/content')
  @RequirePermission('guest.identity.review')
  async idContent(
    @Param('propertyId') propertyId: string,
    @Param('documentId') documentId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.identity.open(propertyId, uuidParam(documentId));
    await reply
      .header('content-type', file.contentType)
      .header('content-length', String(file.sizeBytes))
      .header('content-disposition', 'inline')
      .header('cache-control', 'private, no-store')
      // Never rendered as a page in our origin, whatever the file contains.
      .header('content-security-policy', "sandbox; default-src 'none'")
      .send(file.stream);
  }

  @Post('guest-ids/:documentId/review')
  @RequirePermission('guest.identity.review')
  @HttpCode(200)
  @ZodResponse(200, identityDocumentSchema)
  review(
    @Param('propertyId') propertyId: string,
    @Param('documentId') documentId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(identityReviewSchema) body: IdentityReview,
  ) {
    return this.identity.review(propertyId, uuidParam(documentId), parseIfMatch(ifMatch), body);
  }
}
