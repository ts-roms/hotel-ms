import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  businessDayClosingSchema,
  frontDeskSchema,
  nightAuditPreviewSchema,
  reservationSchema,
  type RunNightAuditRequest,
  runNightAuditRequestSchema,
} from '@hotel/contracts';
import { z } from 'zod';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { FrontOfficeService } from './front-office.service.js';
import { NightAuditService } from './night-audit.service.js';

/** Front desk, check-in and check-out, night audit and business days. */
@ApiTags('front office')
@Controller('properties/:propertyId')
export class FrontOfficeController {
  constructor(
    private readonly frontOffice: FrontOfficeService,
    private readonly nightAudit: NightAuditService,
  ) {}

  // ---- Front desk -------------------------------------------------------------------------

  @Get('front-desk')
  @RequirePermission('reservation.read')
  @ZodResponse(
    200,
    frontDeskSchema,
    'Arrivals, in-house guests and departures for the business date',
  )
  board() {
    return this.frontOffice.board();
  }

  @Post('reservations/:reservationId/rooms/:lineId/check-in')
  @RequirePermission('stay.check_in')
  @HttpCode(200)
  @ZodResponse(200, reservationSchema)
  checkIn(@Param('reservationId') reservationId: string, @Param('lineId') lineId: string) {
    return this.frontOffice.checkIn(uuidParam(reservationId), uuidParam(lineId));
  }

  @Post('reservations/:reservationId/rooms/:lineId/check-out')
  @RequirePermission('stay.check_out')
  @HttpCode(200)
  @ZodResponse(200, reservationSchema)
  checkOut(@Param('reservationId') reservationId: string, @Param('lineId') lineId: string) {
    return this.frontOffice.checkOut(uuidParam(reservationId), uuidParam(lineId));
  }

  // ---- Night audit ------------------------------------------------------------------------

  @Get('night-audit')
  @RequirePermission('night_audit.run')
  @ZodResponse(200, nightAuditPreviewSchema)
  nightAuditPreview() {
    return this.nightAudit.preview();
  }

  @Post('night-audit')
  @RequirePermission('night_audit.run')
  @HttpCode(200)
  @ZodResponse(200, businessDayClosingSchema)
  runNightAudit(@ZodBody(runNightAuditRequestSchema) body: RunNightAuditRequest) {
    return this.nightAudit.run(body.businessDate);
  }

  @Get('business-days')
  @RequirePermission('folio.read')
  @ZodResponse(
    200,
    z.array(businessDayClosingSchema),
    'Closed business days with statistics, newest first',
  )
  closings() {
    return this.nightAudit.closings();
  }
}
