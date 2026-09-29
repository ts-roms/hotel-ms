import { Controller, Get, Headers, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AdjustmentRequest,
  adjustmentRequestSchema,
  type AssignHousekeepingTaskRequest,
  assignHousekeepingTaskRequestSchema,
  businessDayClosingSchema,
  type CreateHousekeepingTaskRequest,
  createHousekeepingTaskRequestSchema,
  type CreateTaxRuleRequest,
  createTaxRuleRequestSchema,
  folioSchema,
  frontDeskSchema,
  housekeepingBoardSchema,
  housekeepingTaskSchema,
  nightAuditPreviewSchema,
  type PostChargeRequest,
  postChargeRequestSchema,
  type RecordPaymentRequest,
  recordPaymentRequestSchema,
  reservationSchema,
  type RunNightAuditRequest,
  runNightAuditRequestSchema,
  type SetHousekeepingStatusRequest,
  setHousekeepingStatusRequestSchema,
  taxRuleSchema,
  type VoidLineRequest,
  voidLineRequestSchema,
  staffRefSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { IdempotencyService, idempotencyKeyHeader } from '../../common/idempotency.js';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { FolioService } from '../finance/folio/folio.service.js';
import { TaxRulesService } from '../pms/pricing/tax-rules.service.js';
import { FrontOfficeService } from './front-office.service.js';
import { HousekeepingService } from '../operations/housekeeping/housekeeping.service.js';
import { NightAuditService } from './night-audit.service.js';

@ApiTags('front office')
@Controller('properties/:propertyId')
export class FrontOfficeController {
  constructor(
    private readonly frontOffice: FrontOfficeService,
    private readonly folios: FolioService,
    private readonly taxes: TaxRulesService,
    private readonly housekeeping: HousekeepingService,
    private readonly nightAudit: NightAuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  private async idempotent<T>(
    operation: string,
    key: string | undefined,
    body: unknown,
    reply: FastifyReply,
    fn: () => Promise<T>,
  ): Promise<T> {
    const result = await this.idempotency.run(operation, key, body, async () => ({
      status: 200,
      body: await fn(),
    }));
    if (result.replayed) reply.header('idempotent-replayed', 'true');
    return result.body;
  }

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

  // ---- Folios -----------------------------------------------------------------------------

  @Get('reservations/:reservationId/rooms/:lineId/folio')
  @RequirePermission('folio.read')
  @ZodResponse(200, folioSchema)
  folioForRoom(@Param('lineId') lineId: string) {
    return this.folios.findForReservationRoom(uuidParam(lineId));
  }

  @Get('folios/:folioId')
  @RequirePermission('folio.read')
  @ZodResponse(200, folioSchema)
  folio(@Param('folioId') folioId: string) {
    return this.folios.get(uuidParam(folioId));
  }

  @Post('folios/:folioId/charges')
  @RequirePermission('folio.post')
  @HttpCode(200)
  @idempotencyKeyHeader
  @ZodResponse(200, folioSchema)
  postCharge(
    @Param('folioId') folioId: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(postChargeRequestSchema) body: PostChargeRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.idempotent('folio.charge', key, { folioId, ...body }, reply, () =>
      this.folios.postCharge(uuidParam(folioId), body),
    );
  }

  @Post('folios/:folioId/payments')
  @RequirePermission('payment.create')
  @HttpCode(200)
  @idempotencyKeyHeader
  @ZodResponse(200, folioSchema)
  recordPayment(
    @Param('folioId') folioId: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(recordPaymentRequestSchema) body: RecordPaymentRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.idempotent('folio.payment', key, { folioId, ...body }, reply, () =>
      this.folios.recordPayment(uuidParam(folioId), body),
    );
  }

  @Post('folios/:folioId/adjustments')
  @RequirePermission('folio.adjust')
  @HttpCode(200)
  @idempotencyKeyHeader
  @ZodResponse(200, folioSchema)
  adjust(
    @Param('folioId') folioId: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(adjustmentRequestSchema) body: AdjustmentRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.idempotent('folio.adjust', key, { folioId, ...body }, reply, () =>
      this.folios.adjust(uuidParam(folioId), body),
    );
  }

  @Post('folios/:folioId/lines/:lineId/void')
  @RequirePermission('folio.void')
  @HttpCode(200)
  @ZodResponse(200, folioSchema)
  voidLine(
    @Param('folioId') folioId: string,
    @Param('lineId') lineId: string,
    @ZodBody(voidLineRequestSchema) body: VoidLineRequest,
  ) {
    return this.folios.voidLine(uuidParam(folioId), uuidParam(lineId), body.reason);
  }

  // ---- Taxes ------------------------------------------------------------------------------

  @Get('tax-rules')
  @RequirePermission('folio.read')
  @ZodResponse(200, z.array(taxRuleSchema))
  taxRules() {
    return this.taxes.listTaxRules();
  }

  @Post('tax-rules')
  @RequirePermission('tax.manage')
  @HttpCode(201)
  @ZodResponse(201, taxRuleSchema)
  createTaxRule(@ZodBody(createTaxRuleRequestSchema) body: CreateTaxRuleRequest) {
    return this.taxes.createTaxRule(body);
  }

  @Post('tax-rules/:taxRuleId/archive')
  @RequirePermission('tax.manage')
  @HttpCode(204)
  async archiveTaxRule(@Param('taxRuleId') taxRuleId: string) {
    await this.taxes.archiveTaxRule(uuidParam(taxRuleId));
  }

  // ---- Housekeeping -----------------------------------------------------------------------

  @Get('housekeeping')
  @RequirePermission('housekeeping.read')
  @ZodResponse(200, housekeepingBoardSchema)
  housekeepingBoard() {
    return this.housekeeping.board();
  }

  @Put('rooms/:roomId/housekeeping-status')
  @RequirePermission('housekeeping.update')
  @ZodResponse(200, housekeepingBoardSchema.shape.rooms.element)
  setHousekeepingStatus(
    @Param('roomId') roomId: string,
    @ZodBody(setHousekeepingStatusRequestSchema) body: SetHousekeepingStatusRequest,
  ) {
    return this.housekeeping.setStatus(uuidParam(roomId), body);
  }

  @Get('housekeeping/staff')
  @RequirePermission('housekeeping.assign')
  @ZodResponse(200, z.array(staffRefSchema))
  housekeepingStaff() {
    return this.housekeeping.staff();
  }

  @Post('housekeeping/tasks')
  @RequirePermission('housekeeping.assign')
  @HttpCode(201)
  @ZodResponse(201, housekeepingTaskSchema)
  createTask(@ZodBody(createHousekeepingTaskRequestSchema) body: CreateHousekeepingTaskRequest) {
    return this.housekeeping.createTask(body);
  }

  @Put('housekeeping/tasks/:taskId/assignee')
  @RequirePermission('housekeeping.assign')
  @ZodResponse(200, housekeepingTaskSchema)
  assignTask(
    @Param('taskId') taskId: string,
    @ZodBody(assignHousekeepingTaskRequestSchema) body: AssignHousekeepingTaskRequest,
  ) {
    return this.housekeeping.assignTask(uuidParam(taskId), body.assignedMembershipId);
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
