import { Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
  listOf,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseIfMatch } from '../../common/etag.js';
import { IdempotencyService, idempotencyKeyHeader } from '../idempotency/idempotency.service.js';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { FolioService } from './folio/folio.service.js';
import { CashierService } from './cashier/cashier.service.js';
import { FolioDocumentsService } from './documents/folio-documents.service.js';
import { FinanceSettingsService } from './settings/finance-settings.service.js';
import { PaymentsService } from './payments/payments.service.js';
import { FinanceReportsService } from './reports/finance-reports.service.js';

@ApiTags('finance')
@Controller('properties/:propertyId')
export class FinanceController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly folios: FolioService,
    private readonly cashier: CashierService,
    private readonly documents: FolioDocumentsService,
    private readonly reports: FinanceReportsService,
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
  @idempotencyKeyHeader
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
    return this.idempotent('payment.refund', key, { paymentId, ...body }, reply, () =>
      this.payments.refund(propertyId, uuidParam(paymentId), body.amountMinor, body.reason),
    );
  }

  @Get('payments/:paymentId/refunds')
  @RequirePermission('folio.read')
  @ZodResponse(200, listOf(refundSchema))
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
  @idempotencyKeyHeader
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
  @ZodResponse(200, listOf(exchangeRateSchema))
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
  @ZodResponse(200, listOf(discountProfileSchema))
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
  @ZodResponse(200, listOf(accountFolioSchema))
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
  @ZodResponse(200, listOf(routingRuleSchema))
  async routingRules(@Param('folioId') folioId: string) {
    return { items: await this.folios.routingRules(uuidParam(folioId)) };
  }

  @Post('folios/:folioId/routing-rules')
  @RequirePermission('folio.transfer')
  @ZodResponse(201, listOf(routingRuleSchema))
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
  @ZodResponse(200, listOf(folioDocumentSchema))
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
  @ZodResponse(200, listOf(cashierShiftSchema))
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
  @ZodResponse(200, listOf(reconciliationRunSchema))
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
