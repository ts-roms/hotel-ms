import type {
  AccountFolio,
  AdjustmentRequest,
  ApplyDiscountRequest,
  CashierShift,
  CreateDiscountProfileRequest,
  DailyReport,
  DiscountProfile,
  ExchangeRate,
  Folio,
  FolioDocument,
  IssueDocumentRequest,
  PaymentIntent,
  PaymentSettings,
  PostChargeRequest,
  Reconciliation,
  ReconciliationRun,
  RecordPaymentRequest,
  Refund,
  RoutingRule,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, items, type PropertyTransport } from '../../http.js';

/** Folios, payments, holds, discounts, accounts, invoices, cashier and finance reports. */
export function financeClient({ call, propertyId }: PropertyTransport) {
  return {
    folio: (folioId: string) =>
      op.FolioController_folio<Folio>(call, { propertyId, folioId }).then(data),
    postCharge: (folioId: string, body: PostChargeRequest, idempotencyKey: string) =>
      op
        .FolioController_postCharge<Folio>(call, { propertyId, folioId }, body, { idempotencyKey })
        .then(data),
    recordPayment: (folioId: string, body: RecordPaymentRequest, idempotencyKey: string) =>
      op
        .FolioController_recordPayment<Folio>(call, { propertyId, folioId }, body, {
          idempotencyKey,
        })
        .then(data),
    adjust: (folioId: string, body: AdjustmentRequest, idempotencyKey: string) =>
      op
        .FolioController_adjust<Folio>(call, { propertyId, folioId }, body, { idempotencyKey })
        .then(data),
    voidLine: (folioId: string, lineId: string, reason: string) =>
      op
        .FolioController_voidLine<Folio>(call, { propertyId, folioId, lineId }, { reason })
        .then(data),
    paymentLink: (folioId: string, amountMinor: number, idempotencyKey: string) =>
      op
        .FinanceController_paymentLink<PaymentIntent>(
          call,
          { propertyId, folioId },
          { amountMinor },
          { idempotencyKey },
        )
        .then(data),
    paymentIntents: (folioId: string) =>
      op
        .FinanceController_intents<{ items: PaymentIntent[] }>(call, { propertyId, folioId })
        .then(items),
    refund: (paymentId: string, amountMinor: number, reason: string, idempotencyKey: string) =>
      op
        .FinanceController_refund<Refund>(
          call,
          { propertyId, paymentId },
          { amountMinor, reason },
          { idempotencyKey },
        )
        .then(data),
    paymentSettings: () =>
      op.FinanceController_paymentSettings<PaymentSettings>(call, { propertyId }).then(data),
    updatePaymentSettings: (body: PaymentSettings) =>
      op
        .FinanceController_updatePaymentSettings<PaymentSettings>(call, { propertyId }, body)
        .then(data),
    captureHold: (intentId: string, amountMinor: number, idempotencyKey: string) =>
      op
        .FinanceController_captureHold<PaymentIntent>(
          call,
          { propertyId, intentId },
          { amountMinor },
          { idempotencyKey },
        )
        .then(data),
    releaseHold: (intentId: string) =>
      op.FinanceController_releaseHold<PaymentIntent>(call, { propertyId, intentId }).then(data),
    exchangeRates: () =>
      op
        .FinanceController_exchangeRates<{ items: ExchangeRate[] }>(call, { propertyId })
        .then(items),
    setExchangeRate: (currency: string, rate: string) =>
      op
        .FinanceController_setExchangeRate<ExchangeRate>(call, { propertyId }, { currency, rate })
        .then(data),
    discountProfiles: () =>
      op
        .FinanceController_discountProfiles<{ items: DiscountProfile[] }>(call, { propertyId })
        .then(items),
    createDiscountProfile: (body: CreateDiscountProfileRequest) =>
      op
        .FinanceController_createDiscountProfile<DiscountProfile>(call, { propertyId }, body)
        .then(data),
    archiveDiscountProfile: (profileId: string) =>
      op.FinanceController_archiveDiscountProfile(call, { propertyId, profileId }).then(data),
    applyDiscount: (folioId: string, body: ApplyDiscountRequest) =>
      op.FinanceController_applyDiscount<Folio>(call, { propertyId, folioId }, body).then(data),
    removeDiscount: (folioId: string) =>
      op.FinanceController_removeDiscount<Folio>(call, { propertyId, folioId }).then(data),
    accounts: () =>
      op.FinanceController_accounts<{ items: AccountFolio[] }>(call, { propertyId }).then(items),
    createAccount: (label: string) =>
      op.FinanceController_createAccount<Folio>(call, { propertyId }, { label }).then(data),
    routingRules: (folioId: string) =>
      op
        .FinanceController_routingRules<{ items: RoutingRule[] }>(call, { propertyId, folioId })
        .then(items),
    addRoutingRule: (folioId: string, targetFolioId: string, departments: string[]) =>
      op
        .FinanceController_addRoutingRule<{ items: RoutingRule[] }>(
          call,
          { propertyId, folioId },
          { targetFolioId, departments },
        )
        .then(items),
    removeRoutingRule: (ruleId: string) =>
      op.FinanceController_removeRoutingRule(call, { propertyId, ruleId }).then(data),
    transfer: (folioId: string, targetFolioId: string, lineIds: string[], reason: string) =>
      op
        .FinanceController_transfer<Folio>(
          call,
          { propertyId, folioId },
          { targetFolioId, lineIds, reason },
        )
        .then(data),
    issueDocument: (folioId: string, body: IssueDocumentRequest) =>
      op.FinanceController_issue<FolioDocument>(call, { propertyId, folioId }, body).then(data),
    documents: (folioId: string) =>
      op
        .FinanceController_documentList<{ items: FolioDocument[] }>(call, { propertyId, folioId })
        .then(items),
    document: (documentId: string) =>
      op.FinanceController_document<FolioDocument>(call, { propertyId, documentId }).then(data),
    cashierShift: () =>
      op
        .FinanceController_currentShift<{ shift: CashierShift | null }>(call, { propertyId })
        .then((r) => r.data.shift),
    openCashierShift: (openingFloatMinor: number) =>
      op
        .FinanceController_openShift<CashierShift>(call, { propertyId }, { openingFloatMinor })
        .then(data),
    closeCashierShift: (
      shiftId: string,
      version: number,
      countedCashMinor: number,
      notes: string,
    ) =>
      op
        .FinanceController_closeShift<CashierShift>(
          call,
          { propertyId, shiftId },
          { countedCashMinor, notes },
          { ifMatch: `W/"${version}"` },
        )
        .then(data),
    cashierShifts: () =>
      op.FinanceController_shifts<{ items: CashierShift[] }>(call, { propertyId }).then(items),
    dailyReport: (date?: string) =>
      op.FinanceController_daily<DailyReport>(call, { propertyId }, { date }).then(data),
    reconciliation: () =>
      op.FinanceController_reconciliation<Reconciliation>(call, { propertyId }).then(data),
    reconciliationRuns: () =>
      op
        .FinanceController_reconciliationRuns<{ items: ReconciliationRun[] }>(call, { propertyId })
        .then(items),
  };
}
