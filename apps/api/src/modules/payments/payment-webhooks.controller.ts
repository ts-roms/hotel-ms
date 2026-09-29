import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Webhook } from '../../common/route-metadata.js';
import { PaymentsService } from './payments.service.js';

/** Provider → us. Authenticated by the provider's signature over the raw body. */
@ApiTags('webhooks')
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':provider')
  @Webhook()
  @HttpCode(200)
  async receive(@Param('provider') provider: string, @Req() req: RawBodyRequest<FastifyRequest>) {
    const raw = req.rawBody ?? Buffer.from('');
    const outcome = await this.payments.handleWebhook(provider, raw, req.headers);
    return { received: true, outcome };
  }
}
