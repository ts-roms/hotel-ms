import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  accountFolioSchema,
  type ApplyDiscountRequest,
  applyDiscountRequestSchema,
  type CaptureHoldRequest,
  captureHoldRequestSchema,
  cashierShiftSchema,
  type CreateDiscountProfileRequest,
  createDiscountProfileRequestSchema,
  type CloseShiftRequest,
  closeShiftRequestSchema,
  type CreateAccountFolioRequest,
  createAccountFolioRequestSchema,
  type CreatePaymentLinkRequest,
  createPaymentLinkRequestSchema,
  type CreateRoutingRuleRequest,
  createRoutingRuleRequestSchema,
  dailyReportQuerySchema,
  type DailyReportQuery,
  dailyReportSchema,
  discountProfileSchema,
  exchangeRateSchema,
  folioDocumentSchema,
  folioSchema,
  type GuestPaymentRequest,
  guestPaymentRequestSchema,
  type IssueDocumentRequest,
  issueDocumentRequestSchema,
  type OpenShiftRequest,
  openShiftRequestSchema,
  paymentIntentSchema,
  type PaymentSettings,
  paymentSettingsSchema,
  reconciliationRunSchema,
  reconciliationSchema,
  type RefundRequest,
  refundRequestSchema,
  refundSchema,
  routingRuleSchema,
  type SetExchangeRateRequest,
  setExchangeRateRequestSchema,
  type TransferRequest,
  transferRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseIfMatch } from '../../common/etag.js';
import { IdempotencyService } from '../../common/idempotency.js';
import { uuidParam } from '../../common/params.js';
import { GuestRoute, Public, RequirePermission, Webhook } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { ENV, type Env } from '../../config/env.js';
import { FolioService } from '../folio/folio.service.js';
import { toMinor } from '../pms/pricing.js';
import { CashierService } from './cashier.service.js';
import { DocumentsService } from './documents.service.js';
import { FinanceSettingsService } from './finance-settings.service.js';
import { PaymentsService } from './payments.service.js';
import { PAYMENT_PROVIDERS, type PaymentProviders, SandboxProvider } from './providers.js';
import { ReportsService } from './reports.service.js';

const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });
const idempotencyHeader = ApiHeader({
  name: 'Idempotency-Key',
  required: true,
  description: 'Unique per attempt; retries reuse it',
});

@ApiTags('finance')
@Controller('properties/:propertyId')
export class FinanceController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly folios: FolioService,
    private readonly cashier: CashierService,
    private readonly documents: DocumentsService,
    private readonly reports: ReportsService,
    private readonly settings: FinanceSettingsService,
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
      status: 201,
      body: await fn(),
    }));
    if (result.replayed) reply.header('idempotent-replayed', 'true');
    return result.body;
  }

  // ---- Online payments and refunds -------------------------------------------------------

  @Post('folios/:folioId/payment-links')
  @RequirePermission('payment.create')
  @idempotencyHeader
  @ZodResponse(201, paymentIntentSchema)
  paymentLink(
    @Param('propertyId') propertyId: string,
    @Param('folioId') folioId: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(createPaymentLinkRequestSchema) body: CreatePaymentLinkRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.idempotent('payment.link', key, { folioId, ...body }, reply, () =>
      this.payments.staffLink(propertyId, uuidParam(folioId), body.amountMinor),
    );
  }

  @Get('folios/:folioId/payment-intents')
  @RequirePermission('folio.read')
  @ZodResponse(200, items(paymentIntentSchema))
  async intents(@Param('folioId') folioId: string) {
    return { items: await this.payments.intentsForFolio(uuidParam(folioId)) };
  }

  @Post('payments/:paymentId/refunds')
  @RequirePermission('payment.refund')
  @idempotencyHeader
  @ZodResponse(201, refundSchema)
  refund(
    @Param('propertyId') propertyId: string,
    @Param('paymentId') paymentId: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(refundRequestSchema) body: RefundRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.idempotent('payment.refund', key, { paymentId, ...body }, reply, () =>
      this.payments.refund(propertyId, uuidParam(paymentId), body.amountMinor, body.reason),
    );
  }

  @Get('payments/:paymentId/refunds')
  @RequirePermission('folio.read')
  @ZodResponse(200, items(refundSchema))
  async refunds(@Param('propertyId') propertyId: string, @Param('paymentId') paymentId: string) {
    return { items: await this.payments.refunds(propertyId, uuidParam(paymentId)) };
  }

  // ---- Card holds ------------------------------------------------------------------------

  @Get('payment-settings')
  @RequirePermission('folio.read')
  @ZodResponse(200, paymentSettingsSchema)
  paymentSettings(@Param('propertyId') propertyId: string) {
    return this.payments.settings(propertyId);
  }

  @Put('payment-settings')
  @RequirePermission('property.settings.manage')
  @ZodResponse(200, paymentSettingsSchema)
  updatePaymentSettings(
    @Param('propertyId') propertyId: string,
    @ZodBody(paymentSettingsSchema.strict()) body: PaymentSettings,
  ) {
    return this.payments.updateSettings(propertyId, body);
  }

  @Post('holds/:intentId/capture')
  @RequirePermission('payment.create')
  @idempotencyHeader
  @HttpCode(200)
  @ZodResponse(200, paymentIntentSchema)
  async captureHold(
    @Param('propertyId') propertyId: string,
    @Param('intentId') intentId: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(captureHoldRequestSchema) body: CaptureHoldRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.run(
      'payment.hold_capture',
      key,
      { intentId, ...body },
      async () => ({
        status: 200,
        body: await this.payments.captureHold(propertyId, uuidParam(intentId), body.amountMinor),
      }),
    );
    if (result.replayed) reply.header('idempotent-replayed', 'true');
    return result.body;
  }

  @Post('holds/:intentId/release')
  @RequirePermission('payment.create')
  @HttpCode(200)
  @ZodResponse(200, paymentIntentSchema)
  releaseHold(@Param('propertyId') propertyId: string, @Param('intentId') intentId: string) {
    return this.payments.releaseHold(propertyId, uuidParam(intentId));
  }

  // ---- Foreign cash and statutory discounts ----------------------------------------------

  @Get('exchange-rates')
  @RequirePermission('folio.read')
  @ZodResponse(200, items(exchangeRateSchema))
  async exchangeRates(@Param('propertyId') propertyId: string) {
    return { items: await this.settings.exchangeRates(propertyId) };
  }

  @Post('exchange-rates')
  @RequirePermission('exchange_rate.manage')
  @ZodResponse(201, exchangeRateSchema)
  setExchangeRate(
    @Param('propertyId') propertyId: string,
    @ZodBody(setExchangeRateRequestSchema) body: SetExchangeRateRequest,
  ) {
    return this.settings.setExchangeRate(propertyId, body);
  }

  @Get('discount-profiles')
  @RequirePermission('folio.read')
  @ZodResponse(200, items(discountProfileSchema))
  async discountProfiles(@Param('propertyId') propertyId: string) {
    return { items: await this.settings.discountProfiles(propertyId) };
  }

  @Post('discount-profiles')
  @RequirePermission('tax.manage')
  @ZodResponse(201, discountProfileSchema)
  createDiscountProfile(
    @Param('propertyId') propertyId: string,
    @ZodBody(createDiscountProfileRequestSchema) body: CreateDiscountProfileRequest,
  ) {
    return this.settings.createDiscountProfile(propertyId, body);
  }

  @Post('discount-profiles/:profileId/archive')
  @RequirePermission('tax.manage')
  @HttpCode(204)
  async archiveDiscountProfile(
    @Param('propertyId') propertyId: string,
    @Param('profileId') profileId: string,
  ): Promise<void> {
    await this.settings.archiveDiscountProfile(propertyId, uuidParam(profileId));
  }

  @Put('folios/:folioId/discount')
  @RequirePermission('folio.discount')
  @ZodResponse(200, folioSchema)
  applyDiscount(
    @Param('folioId') folioId: string,
    @ZodBody(applyDiscountRequestSchema) body: ApplyDiscountRequest,
  ) {
    return this.folios.applyDiscount(uuidParam(folioId), body);
  }

  @Delete('folios/:folioId/discount')
  @RequirePermission('folio.discount')
  @ZodResponse(200, folioSchema)
  removeDiscount(@Param('folioId') folioId: string) {
    return this.folios.removeDiscount(uuidParam(folioId));
  }

  // ---- Accounts, routing, transfers ------------------------------------------------------

  @Get('accounts')
  @RequirePermission('folio.read')
  @ZodResponse(200, items(accountFolioSchema))
  async accounts() {
    return { items: await this.folios.accounts() };
  }

  @Post('accounts')
  @RequirePermission('folio.transfer')
  @ZodResponse(201, folioSchema)
  createAccount(@ZodBody(createAccountFolioRequestSchema) body: CreateAccountFolioRequest) {
    return this.folios.createAccount(body.label);
  }

  @Get('folios/:folioId/routing-rules')
  @RequirePermission('folio.read')
  @ZodResponse(200, items(routingRuleSchema))
  async routingRules(@Param('folioId') folioId: string) {
    return { items: await this.folios.routingRules(uuidParam(folioId)) };
  }

  @Post('folios/:folioId/routing-rules')
  @RequirePermission('folio.transfer')
  @ZodResponse(201, items(routingRuleSchema))
  async addRoutingRule(
    @Param('folioId') folioId: string,
    @ZodBody(createRoutingRuleRequestSchema) body: CreateRoutingRuleRequest,
  ) {
    return {
      items: await this.folios.addRoutingRule(
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
    await this.folios.removeRoutingRule(uuidParam(ruleId));
  }

  @Post('folios/:folioId/transfers')
  @RequirePermission('folio.transfer')
  @HttpCode(200)
  @ZodResponse(200, folioSchema)
  transfer(
    @Param('folioId') folioId: string,
    @ZodBody(transferRequestSchema) body: TransferRequest,
  ) {
    return this.folios.transfer(uuidParam(folioId), body);
  }

  // ---- Documents -------------------------------------------------------------------------

  @Post('folios/:folioId/documents')
  @RequirePermission('invoice.issue')
  @ZodResponse(201, folioDocumentSchema)
  issue(
    @Param('propertyId') propertyId: string,
    @Param('folioId') folioId: string,
    @ZodBody(issueDocumentRequestSchema) body: IssueDocumentRequest,
  ) {
    return this.documents.issue(propertyId, uuidParam(folioId), body);
  }

  @Get('folios/:folioId/documents')
  @RequirePermission('folio.read')
  @ZodResponse(200, items(folioDocumentSchema))
  async documentList(@Param('propertyId') propertyId: string, @Param('folioId') folioId: string) {
    return { items: await this.documents.list(propertyId, uuidParam(folioId)) };
  }

  @Get('documents/:documentId')
  @RequirePermission('folio.read')
  @ZodResponse(200, folioDocumentSchema)
  document(@Param('propertyId') propertyId: string, @Param('documentId') id: string) {
    return this.documents.get(propertyId, uuidParam(id));
  }

  // ---- Cashier ---------------------------------------------------------------------------

  @Get('cashier/shift')
  @RequirePermission('cashier.shift')
  @ZodResponse(200, z.object({ shift: cashierShiftSchema.nullable() }))
  async currentShift(@Param('propertyId') propertyId: string) {
    return { shift: await this.cashier.current(propertyId) };
  }

  @Post('cashier/shift')
  @RequirePermission('cashier.shift')
  @ZodResponse(201, cashierShiftSchema)
  openShift(
    @Param('propertyId') propertyId: string,
    @ZodBody(openShiftRequestSchema) body: OpenShiftRequest,
  ) {
    return this.cashier.open(propertyId, body.openingFloatMinor);
  }

  @Post('cashier/shifts/:shiftId/close')
  @RequirePermission('cashier.shift')
  @HttpCode(200)
  @ZodResponse(200, cashierShiftSchema)
  closeShift(
    @Param('propertyId') propertyId: string,
    @Param('shiftId') shiftId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(closeShiftRequestSchema) body: CloseShiftRequest,
  ) {
    return this.cashier.close(
      propertyId,
      uuidParam(shiftId),
      parseIfMatch(ifMatch),
      body.countedCashMinor,
      body.notes,
    );
  }

  @Get('cashier/shifts')
  @RequirePermission('finance.report.read')
  @ZodResponse(200, items(cashierShiftSchema))
  async shifts(@Param('propertyId') propertyId: string) {
    return { items: await this.cashier.list(propertyId) };
  }

  // ---- Reports ---------------------------------------------------------------------------

  @Get('reports/daily')
  @RequirePermission('finance.report.read')
  @ZodResponse(200, dailyReportSchema)
  daily(
    @Param('propertyId') propertyId: string,
    @ZodQuery(dailyReportQuerySchema) query: DailyReportQuery,
  ) {
    return this.reports.daily(propertyId, query.date);
  }

  @Get('reports/reconciliation-runs')
  @RequirePermission('finance.report.read')
  @ZodResponse(200, items(reconciliationRunSchema))
  async reconciliationRuns(@Param('propertyId') propertyId: string) {
    return { items: await this.reports.runs(propertyId) };
  }

  @Get('reports/reconciliation')
  @RequirePermission('finance.report.read')
  @ZodResponse(200, reconciliationSchema)
  reconciliation(@Param('propertyId') propertyId: string) {
    return this.reports.reconciliation(propertyId);
  }
}

/** Guest portal: pay the stay folio online (hosted checkout). */
@ApiTags('guest portal')
@Controller('guest')
@GuestRoute({ verified: true })
export class GuestPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('payments')
  @idempotencyHeader
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
  @ZodResponse(200, items(paymentIntentSchema))
  async list() {
    return { items: await this.payments.guestIntents() };
  }

  /** Card hold (pre-authorization) the property asks for before self check-in. */
  @Post('holds')
  @idempotencyHeader
  @ZodResponse(201, paymentIntentSchema)
  async hold(
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.run('guest.hold', key, {}, async () => ({
      status: 201,
      body: await this.payments.guestHold(),
    }));
    if (result.replayed) reply.header('idempotent-replayed', 'true');
    return result.body;
  }
}

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

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

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
    const amount = new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: intent.currency,
    }).format(toMinor(intent.amountMinor) / 100);
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
      await this.payments.handleWebhook('sandbox', Buffer.from(event.rawBody), event.headers);
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
