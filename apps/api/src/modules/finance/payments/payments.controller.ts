import { Controller, Get, Headers, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CaptureHoldRequest,
  captureHoldRequestSchema,
  type CreatePaymentLinkRequest,
  createPaymentLinkRequestSchema,
  listOf,
  paymentIntentSchema,
  type PaymentSettings,
  paymentSettingsSchema,
  type RefundRequest,
  refundRequestSchema,
  refundSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { IdempotencyService, idempotencyKeyHeader } from '../../idempotency/idempotency.service.js';
import { CardHoldsService } from './card-holds.service.js';
import { PaymentsService } from './payments.service.js';
import { RefundsService } from './refunds.service.js';

/** Staff side of online payments: payment links, refunds, card holds and their settings. */
@ApiTags('finance')
@Controller('properties/:propertyId')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly refundsService: RefundsService,
    private readonly holds: CardHoldsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('folios/:folioId/payment-links')
  @RequirePermission('payment.create')
  @idempotencyKeyHeader
  @ZodResponse(201, paymentIntentSchema)
  paymentLink(
    @Param('propertyId') propertyId: string,
    @Param('folioId') folioId: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(createPaymentLinkRequestSchema) body: CreatePaymentLinkRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.idempotency.respond(reply, 'payment.link', key, { folioId, ...body }, 201, () =>
      this.payments.staffLink(propertyId, uuidParam(folioId), body.amountMinor),
    );
  }

  @Get('folios/:folioId/payment-intents')
  @RequirePermission('folio.read')
  @ZodResponse(200, listOf(paymentIntentSchema))
  async intents(@Param('folioId') folioId: string) {
    return { items: await this.payments.intentsForFolio(uuidParam(folioId)) };
  }

  @Post('payments/:paymentId/refunds')
  @RequirePermission('payment.refund')
  @idempotencyKeyHeader
  @ZodResponse(201, refundSchema)
  refund(
    @Param('propertyId') propertyId: string,
    @Param('paymentId') paymentId: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(refundRequestSchema) body: RefundRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.idempotency.respond(reply, 'payment.refund', key, { paymentId, ...body }, 201, () =>
      this.refundsService.refund(propertyId, uuidParam(paymentId), body.amountMinor, body.reason),
    );
  }

  @Get('payments/:paymentId/refunds')
  @RequirePermission('folio.read')
  @ZodResponse(200, listOf(refundSchema))
  async refunds(@Param('propertyId') propertyId: string, @Param('paymentId') paymentId: string) {
    return { items: await this.refundsService.refunds(propertyId, uuidParam(paymentId)) };
  }

  // ---- Card holds ------------------------------------------------------------------------

  @Get('payment-settings')
  @RequirePermission('folio.read')
  @ZodResponse(200, paymentSettingsSchema)
  paymentSettings(@Param('propertyId') propertyId: string) {
    return this.holds.settings(propertyId);
  }

  @Put('payment-settings')
  @RequirePermission('property.settings.manage')
  @ZodResponse(200, paymentSettingsSchema)
  updatePaymentSettings(
    @Param('propertyId') propertyId: string,
    @ZodBody(paymentSettingsSchema.strict()) body: PaymentSettings,
  ) {
    return this.holds.updateSettings(propertyId, body);
  }

  @Post('holds/:intentId/capture')
  @RequirePermission('payment.create')
  @idempotencyKeyHeader
  @HttpCode(200)
  @ZodResponse(200, paymentIntentSchema)
  captureHold(
    @Param('propertyId') propertyId: string,
    @Param('intentId') intentId: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(captureHoldRequestSchema) body: CaptureHoldRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.idempotency.respond(
      reply,
      'payment.hold_capture',
      key,
      { intentId, ...body },
      200,
      () => this.holds.captureHold(propertyId, uuidParam(intentId), body.amountMinor),
    );
  }

  @Post('holds/:intentId/release')
  @RequirePermission('payment.create')
  @HttpCode(200)
  @ZodResponse(200, paymentIntentSchema)
  releaseHold(@Param('propertyId') propertyId: string, @Param('intentId') intentId: string) {
    return this.holds.releaseHold(propertyId, uuidParam(intentId));
  }
}
