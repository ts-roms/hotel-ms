import { Controller, Get, Headers, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type GuestPaymentRequest,
  guestPaymentRequestSchema,
  paymentIntentSchema,
  listOf,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { IdempotencyService, idempotencyKeyHeader } from '../../idempotency/idempotency.service.js';
import { GuestRoute } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { CardHoldsService } from './card-holds.service.js';
import { PaymentsService } from './payments.service.js';

/** Guest portal: pay the stay folio online (hosted checkout). */
@ApiTags('guest portal')
@Controller('guest')
@GuestRoute({ verified: true })
export class GuestPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly holds: CardHoldsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('payments')
  @idempotencyKeyHeader
  @ZodResponse(201, paymentIntentSchema)
  async pay(
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(guestPaymentRequestSchema) body: GuestPaymentRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.run('guest.payment', key, body, async () => ({
      status: 201,
      body: await this.payments.guestPay(body.amountMinor),
    }));
    if (result.replayed) reply.header('idempotent-replayed', 'true');
    return result.body;
  }

  @Get('payments')
  @ZodResponse(200, listOf(paymentIntentSchema))
  async list() {
    return { items: await this.payments.guestIntents() };
  }

  /** Card hold (pre-authorization) the property asks for before self check-in. */
  @Post('holds')
  @idempotencyKeyHeader
  @ZodResponse(201, paymentIntentSchema)
  async hold(
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.run('guest.hold', key, {}, async () => ({
      status: 201,
      body: await this.holds.guestHold(),
    }));
    if (result.replayed) reply.header('idempotent-replayed', 'true');
    return result.body;
  }
}
