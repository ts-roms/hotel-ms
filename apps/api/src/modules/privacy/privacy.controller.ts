import { Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AnonymizeRequest,
  anonymizeRequestSchema,
  anonymizeResultSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { sendJsonDownload } from '../../common/download.js';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { PrivacyService } from './privacy.service.js';

/** A data export as a download; never cached. */
const sendExport = (reply: FastifyReply, name: string, data: unknown) =>
  sendJsonDownload(reply, `${name}.json`, data);

/** Data requests (ADR-0030): export or anonymize one person's personal data. */
@ApiTags('privacy')
@Controller()
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('guests/:guestId/export')
  @RequirePermission('privacy.manage', 'organization')
  async exportGuest(@Param('guestId') guestId: string, @Res() reply: FastifyReply) {
    const id = uuidParam(guestId);
    await sendExport(reply, `guest-${id}`, await this.privacy.exportGuest(id));
  }

  @Post('guests/:guestId/anonymize')
  @RequirePermission('privacy.manage', 'organization')
  @HttpCode(200)
  @ZodResponse(200, anonymizeResultSchema)
  anonymizeGuest(
    @Param('guestId') guestId: string,
    @ZodBody(anonymizeRequestSchema) body: AnonymizeRequest,
  ) {
    return this.privacy.anonymizeGuest(uuidParam(guestId), body.reason);
  }

  @Get('employees/:employeeId/export')
  @RequirePermission('privacy.manage', 'organization')
  async exportEmployee(@Param('employeeId') employeeId: string, @Res() reply: FastifyReply) {
    const id = uuidParam(employeeId);
    await sendExport(reply, `employee-${id}`, await this.privacy.exportEmployee(id));
  }

  @Post('employees/:employeeId/anonymize')
  @RequirePermission('privacy.manage', 'organization')
  @HttpCode(200)
  @ZodResponse(200, anonymizeResultSchema)
  anonymizeEmployee(
    @Param('employeeId') employeeId: string,
    @ZodBody(anonymizeRequestSchema) body: AnonymizeRequest,
  ) {
    return this.privacy.anonymizeEmployee(uuidParam(employeeId), body.reason);
  }
}
