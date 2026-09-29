import { Controller, Get, Inject, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { escapeHtml } from '@hotel/format';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { formatMinor, toMinor } from '../../../common/money.js';
import { Public, Webhook } from '../../../common/route-metadata.js';
import { ENV, type Env } from '../../../config/env.js';
import { PaymentWebhooksService } from './payment-webhooks.service.js';
import { PaymentsService } from './payments.service.js';
import { PAYMENT_PROVIDERS, type PaymentProviders } from './providers.js';
import { SandboxProvider } from './sandbox.provider.js';

/**
 * The sandbox gateway's hosted checkout (development, tests, staging only). A payer
 * chooses "Pay" or "Decline"; the sandbox then sends the signed webhook and returns the
 * payer to the merchant, as a real provider would.
 */
@ApiExcludeController()
@Controller('sandbox-gateway/checkout')
export class SandboxGatewayController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly webhooks: PaymentWebhooksService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProviders,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private sandbox(): SandboxProvider {
    const provider = this.providers.get('sandbox');
    if (!this.env.PAYMENT_SANDBOX_ENABLED || !(provider instanceof SandboxProvider))
      throw new NotFoundException();
    return provider;
  }

  @Get(':reference')
  @Public()
  async page(@Param('reference') reference: string, @Res() reply: FastifyReply): Promise<void> {
    this.sandbox();
    const intent = await this.payments.findByReference('sandbox', reference);
    if (!intent) throw new NotFoundException();
    const amount = formatMinor(intent.amountMinor, intent.currency);
    const base = `/api/v1/sandbox-gateway/checkout/${encodeURIComponent(reference)}`;
    const verb = intent.kind === 'HOLD' ? 'Authorize a hold of' : 'Pay';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sandbox checkout</title></head>
<body><h1>Sandbox checkout</h1><p>Test payments only. No money moves.</p>
<p>Amount: <strong>${escapeHtml(amount)}</strong></p><p>Status: ${escapeHtml(intent.status)}</p>
${
  intent.status === 'PENDING'
    ? `<form method="post" action="${base}/pay"><label>Method <select name="method"><option value="CARD">Card</option><option value="EWALLET">E-wallet</option></select></label> <button type="submit">${verb} ${escapeHtml(amount)}</button></form>
<form method="post" action="${base}/decline"><button type="submit">Decline</button></form>`
    : ''
}
</body></html>`;
    await reply.type('text/html; charset=utf-8').send(html);
  }

  private async complete(
    reference: string,
    outcome: 'pay' | 'decline',
    method: string,
    reply: FastifyReply,
  ) {
    const sandbox = this.sandbox();
    const intent = await this.payments.findByReference('sandbox', reference);
    if (!intent) throw new NotFoundException();
    if (intent.status === 'PENDING') {
      const event = sandbox.event({
        type:
          outcome === 'decline'
            ? 'payment.failed'
            : intent.kind === 'HOLD'
              ? 'payment.authorized'
              : 'payment.succeeded',
        reference,
        amountMinor: toMinor(intent.amountMinor),
        currency: intent.currency,
        method: method === 'EWALLET' ? 'EWALLET' : 'CARD',
        ...(outcome === 'decline' ? { failureReason: 'Declined by the payer (sandbox)' } : {}),
      });
      // Delivered in-process, through the same verification path as a real webhook.
      await this.webhooks.handleWebhook('sandbox', Buffer.from(event.rawBody), event.headers);
    }
    await reply.redirect(intent.returnUrl, 303);
  }

  @Post(':reference/pay')
  @Webhook()
  pay(
    @Param('reference') reference: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const method = (req.body as { method?: string } | undefined)?.method ?? 'CARD';
    return this.complete(reference, 'pay', method, reply);
  }

  @Post(':reference/decline')
  @Webhook()
  decline(@Param('reference') reference: string, @Res() reply: FastifyReply) {
    return this.complete(reference, 'decline', 'CARD', reply);
  }
}
