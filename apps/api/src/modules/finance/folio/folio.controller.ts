import { Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  accountFolioSchema,
  type AdjustmentRequest,
  adjustmentRequestSchema,
  type ApplyDiscountRequest,
  applyDiscountRequestSchema,
  type CreateAccountFolioRequest,
  createAccountFolioRequestSchema,
  type CreateRoutingRuleRequest,
  createRoutingRuleRequestSchema,
  folioSchema,
  listOf,
  type PostChargeRequest,
  postChargeRequestSchema,
  type RecordPaymentRequest,
  recordPaymentRequestSchema,
  routingRuleSchema,
  type TransferRequest,
  transferRequestSchema,
  type VoidLineRequest,
  voidLineRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { IdempotencyService, idempotencyKeyHeader } from '../../idempotency/idempotency.service.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { FolioDiscountsService } from './folio-discounts.service.js';
import { FolioRoutingService } from './folio-routing.service.js';
import { FolioService } from './folio.service.js';

/**
 * The folio ledger at the desk: a stay's folio, charges, payments, adjustments, voids;
 * statutory discounts; company accounts, routing rules and transfers.
 */
@ApiTags('finance')
@Controller('properties/:propertyId')
export class FolioController {
  constructor(
    private readonly folios: FolioService,
    private readonly discounts: FolioDiscountsService,
    private readonly routing: FolioRoutingService,
    private readonly idempotency: IdempotencyService,
  ) {}

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
    return this.idempotency.respond(reply, 'folio.charge', key, { folioId, ...body }, 200, () =>
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
    return this.idempotency.respond(reply, 'folio.payment', key, { folioId, ...body }, 200, () =>
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
    return this.idempotency.respond(reply, 'folio.adjust', key, { folioId, ...body }, 200, () =>
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

  // ---- Statutory discounts ----------------------------------------------------------------

  @Put('folios/:folioId/discount')
  @RequirePermission('folio.discount')
  @ZodResponse(200, folioSchema)
  applyDiscount(
    @Param('folioId') folioId: string,
    @ZodBody(applyDiscountRequestSchema) body: ApplyDiscountRequest,
  ) {
    return this.discounts.applyDiscount(uuidParam(folioId), body);
  }

  @Delete('folios/:folioId/discount')
  @RequirePermission('folio.discount')
  @ZodResponse(200, folioSchema)
  removeDiscount(@Param('folioId') folioId: string) {
    return this.discounts.removeDiscount(uuidParam(folioId));
  }

  // ---- Accounts, routing, transfers ------------------------------------------------------

  @Get('accounts')
  @RequirePermission('folio.read')
  @ZodResponse(200, listOf(accountFolioSchema))
  async accounts() {
    return { items: await this.routing.accounts() };
  }

  @Post('accounts')
  @RequirePermission('folio.transfer')
  @ZodResponse(201, folioSchema)
  createAccount(@ZodBody(createAccountFolioRequestSchema) body: CreateAccountFolioRequest) {
    return this.routing.createAccount(body.label);
  }

  @Get('folios/:folioId/routing-rules')
  @RequirePermission('folio.read')
  @ZodResponse(200, listOf(routingRuleSchema))
  async routingRules(@Param('folioId') folioId: string) {
    return { items: await this.routing.routingRules(uuidParam(folioId)) };
  }

  @Post('folios/:folioId/routing-rules')
  @RequirePermission('folio.transfer')
  @ZodResponse(201, listOf(routingRuleSchema))
  async addRoutingRule(
    @Param('folioId') folioId: string,
    @ZodBody(createRoutingRuleRequestSchema) body: CreateRoutingRuleRequest,
  ) {
    return {
      items: await this.routing.addRoutingRule(
        uuidParam(folioId),
        body.targetFolioId,
        body.departments,
      ),
    };
  }

  @Delete('routing-rules/:ruleId')
  @RequirePermission('folio.transfer')
  @HttpCode(204)
  async removeRoutingRule(@Param('ruleId') ruleId: string): Promise<void> {
    await this.routing.removeRoutingRule(uuidParam(ruleId));
  }

  @Post('folios/:folioId/transfers')
  @RequirePermission('folio.transfer')
  @HttpCode(200)
  @ZodResponse(200, folioSchema)
  transfer(
    @Param('folioId') folioId: string,
    @ZodBody(transferRequestSchema) body: TransferRequest,
  ) {
    return this.routing.transfer(uuidParam(folioId), body);
  }
}
