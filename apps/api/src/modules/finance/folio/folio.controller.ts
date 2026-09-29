import { Controller, Get, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AdjustmentRequest,
  adjustmentRequestSchema,
  folioSchema,
  type PostChargeRequest,
  postChargeRequestSchema,
  type RecordPaymentRequest,
  recordPaymentRequestSchema,
  type VoidLineRequest,
  voidLineRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { IdempotencyService, idempotencyKeyHeader } from '../../idempotency/idempotency.service.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { FolioService } from './folio.service.js';

/** The folio ledger at the desk: a stay's folio, charges, payments, adjustments, voids. */
@ApiTags('finance')
@Controller('properties/:propertyId')
export class FolioController {
  constructor(
    private readonly folios: FolioService,
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
}
