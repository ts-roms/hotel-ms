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
        .PaymentsController_paymentLink<PaymentIntent>(
          call,
          { propertyId, folioId },
          { amountMinor },
          { idempotencyKey },
        )
        .then(data),
    paymentIntents: (folioId: string) =>
      op
        .PaymentsController_intents<{ items: PaymentIntent[] }>(call, { propertyId, folioId })
        .then(items),
    refund: (paymentId: string, amountMinor: number, reason: string, idempotencyKey: string) =>
      op
        .PaymentsController_refund<Refund>(
          call,
          { propertyId, paymentId },
          { amountMinor, reason },
          { idempotencyKey },
        )
        .then(data),
    paymentSettings: () =>
      op.PaymentsController_paymentSettings<PaymentSettings>(call, { propertyId }).then(data),
    updatePaymentSettings: (body: PaymentSettings) =>
      op
        .PaymentsController_updatePaymentSettings<PaymentSettings>(call, { propertyId }, body)
        .then(data),
    captureHold: (intentId: string, amountMinor: number, idempotencyKey: string) =>
      op
        .PaymentsController_captureHold<PaymentIntent>(
          call,
          { propertyId, intentId },
          { amountMinor },
          { idempotencyKey },
        )
        .then(data),
    releaseHold: (intentId: string) =>
      op.PaymentsController_releaseHold<PaymentIntent>(call, { propertyId, intentId }).then(data),
    exchangeRates: () =>
      op
        .FinanceSettingsController_exchangeRates<{ items: ExchangeRate[] }>(call, { propertyId })
        .then(items),
    setExchangeRate: (currency: string, rate: string) =>
      op
        .FinanceSettingsController_setExchangeRate<ExchangeRate>(
          call,
          { propertyId },
          { currency, rate },
        )
        .then(data),
    discountProfiles: () =>
      op
        .FinanceSettingsController_discountProfiles<{ items: DiscountProfile[] }>(call, {
          propertyId,
        })
        .then(items),
    createDiscountProfile: (body: CreateDiscountProfileRequest) =>
      op
        .FinanceSettingsController_createDiscountProfile<DiscountProfile>(
          call,
          { propertyId },
          body,
        )
        .then(data),
    archiveDiscountProfile: (profileId: string) =>
      op
        .FinanceSettingsController_archiveDiscountProfile(call, { propertyId, profileId })
        .then(data),
    applyDiscount: (folioId: string, body: ApplyDiscountRequest) =>
      op.FolioController_applyDiscount<Folio>(call, { propertyId, folioId }, body).then(data),
    removeDiscount: (folioId: string) =>
      op.FolioController_removeDiscount<Folio>(call, { propertyId, folioId }).then(data),
    accounts: () =>
      op.FolioController_accounts<{ items: AccountFolio[] }>(call, { propertyId }).then(items),
    createAccount: (label: string) =>
      op.FolioController_createAccount<Folio>(call, { propertyId }, { label }).then(data),
    routingRules: (folioId: string) =>
      op
        .FolioController_routingRules<{ items: RoutingRule[] }>(call, { propertyId, folioId })
        .then(items),
    addRoutingRule: (folioId: string, targetFolioId: string, departments: string[]) =>
      op
        .FolioController_addRoutingRule<{ items: RoutingRule[] }>(
          call,
          { propertyId, folioId },
          { targetFolioId, departments },
        )
        .then(items),
    removeRoutingRule: (ruleId: string) =>
      op.FolioController_removeRoutingRule(call, { propertyId, ruleId }).then(data),
    transfer: (folioId: string, targetFolioId: string, lineIds: string[], reason: string) =>
      op
        .FolioController_transfer<Folio>(
          call,
          { propertyId, folioId },
          { targetFolioId, lineIds, reason },
        )
        .then(data),
    issueDocument: (folioId: string, body: IssueDocumentRequest) =>
      op
        .FolioDocumentsController_issue<FolioDocument>(call, { propertyId, folioId }, body)
        .then(data),
    documents: (folioId: string) =>
      op
        .FolioDocumentsController_documentList<{ items: FolioDocument[] }>(call, {
          propertyId,
          folioId,
        })
        .then(items),
    document: (documentId: string) =>
      op
        .FolioDocumentsController_document<FolioDocument>(call, { propertyId, documentId })
        .then(data),
    cashierShift: () =>
      op
        .CashierController_currentShift<{ shift: CashierShift | null }>(call, { propertyId })
        .then((r) => r.data.shift),
    openCashierShift: (openingFloatMinor: number) =>
      op
        .CashierController_openShift<CashierShift>(call, { propertyId }, { openingFloatMinor })
        .then(data),
    closeCashierShift: (
      shiftId: string,
      version: number,
      countedCashMinor: number,
      notes: string,
    ) =>
      op
        .CashierController_closeShift<CashierShift>(
          call,
          { propertyId, shiftId },
          { countedCashMinor, notes },
          { ifMatch: `W/"${version}"` },
        )
        .then(data),
    cashierShifts: () =>
      op.CashierController_shifts<{ items: CashierShift[] }>(call, { propertyId }).then(items),
    dailyReport: (date?: string) =>
      op.FinanceReportsController_daily<DailyReport>(call, { propertyId }, { date }).then(data),
    reconciliation: () =>
      op.FinanceReportsController_reconciliation<Reconciliation>(call, { propertyId }).then(data),
    reconciliationRuns: () =>
      op
        .FinanceReportsController_reconciliationRuns<{ items: ReconciliationRun[] }>(call, {
          propertyId,
        })
        .then(items),
  };
}
