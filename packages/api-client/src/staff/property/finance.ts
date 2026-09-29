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
import type { PropertyTransport } from '../../http.js';

/** Folios, payments, holds, discounts, accounts, invoices, cashier and finance reports. */
export function financeClient({ call, qs, p, id }: PropertyTransport) {
  return {
    folio: (folioId: string) =>
      call<Folio>('GET', `${p}/folios/${id(folioId)}`).then((r) => r.data),
    postCharge: (folioId: string, body: PostChargeRequest, idempotencyKey: string) =>
      call<Folio>('POST', `${p}/folios/${id(folioId)}/charges`, body, {
        'idempotency-key': idempotencyKey,
      }).then((r) => r.data),
    recordPayment: (folioId: string, body: RecordPaymentRequest, idempotencyKey: string) =>
      call<Folio>('POST', `${p}/folios/${id(folioId)}/payments`, body, {
        'idempotency-key': idempotencyKey,
      }).then((r) => r.data),
    adjust: (folioId: string, body: AdjustmentRequest, idempotencyKey: string) =>
      call<Folio>('POST', `${p}/folios/${id(folioId)}/adjustments`, body, {
        'idempotency-key': idempotencyKey,
      }).then((r) => r.data),
    voidLine: (folioId: string, lineId: string, reason: string) =>
      call<Folio>('POST', `${p}/folios/${id(folioId)}/lines/${id(lineId)}/void`, {
        reason,
      }).then((r) => r.data),
    paymentLink: (folioId: string, amountMinor: number, idempotencyKey: string) =>
      call<PaymentIntent>(
        'POST',
        `${p}/folios/${id(folioId)}/payment-links`,
        { amountMinor },
        {
          'idempotency-key': idempotencyKey,
        },
      ).then((r) => r.data),
    paymentIntents: (folioId: string) =>
      call<{ items: PaymentIntent[] }>('GET', `${p}/folios/${id(folioId)}/payment-intents`).then(
        (r) => r.data.items,
      ),
    refund: (paymentId: string, amountMinor: number, reason: string, idempotencyKey: string) =>
      call<Refund>(
        'POST',
        `${p}/payments/${id(paymentId)}/refunds`,
        { amountMinor, reason },
        {
          'idempotency-key': idempotencyKey,
        },
      ).then((r) => r.data),
    paymentSettings: () =>
      call<PaymentSettings>('GET', `${p}/payment-settings`).then((r) => r.data),
    updatePaymentSettings: (body: PaymentSettings) =>
      call<PaymentSettings>('PUT', `${p}/payment-settings`, body).then((r) => r.data),
    captureHold: (intentId: string, amountMinor: number, idempotencyKey: string) =>
      call<PaymentIntent>(
        'POST',
        `${p}/holds/${id(intentId)}/capture`,
        { amountMinor },
        { 'idempotency-key': idempotencyKey },
      ).then((r) => r.data),
    releaseHold: (intentId: string) =>
      call<PaymentIntent>('POST', `${p}/holds/${id(intentId)}/release`).then((r) => r.data),
    exchangeRates: () =>
      call<{ items: ExchangeRate[] }>('GET', `${p}/exchange-rates`).then((r) => r.data.items),
    setExchangeRate: (currency: string, rate: string) =>
      call<ExchangeRate>('POST', `${p}/exchange-rates`, { currency, rate }).then((r) => r.data),
    discountProfiles: () =>
      call<{ items: DiscountProfile[] }>('GET', `${p}/discount-profiles`).then((r) => r.data.items),
    createDiscountProfile: (body: CreateDiscountProfileRequest) =>
      call<DiscountProfile>('POST', `${p}/discount-profiles`, body).then((r) => r.data),
    archiveDiscountProfile: (profileId: string) =>
      call<void>('POST', `${p}/discount-profiles/${id(profileId)}/archive`).then((r) => r.data),
    applyDiscount: (folioId: string, body: ApplyDiscountRequest) =>
      call<Folio>('PUT', `${p}/folios/${id(folioId)}/discount`, body).then((r) => r.data),
    removeDiscount: (folioId: string) =>
      call<Folio>('DELETE', `${p}/folios/${id(folioId)}/discount`).then((r) => r.data),
    accounts: () =>
      call<{ items: AccountFolio[] }>('GET', `${p}/accounts`).then((r) => r.data.items),
    createAccount: (label: string) =>
      call<Folio>('POST', `${p}/accounts`, { label }).then((r) => r.data),
    routingRules: (folioId: string) =>
      call<{ items: RoutingRule[] }>('GET', `${p}/folios/${id(folioId)}/routing-rules`).then(
        (r) => r.data.items,
      ),
    addRoutingRule: (folioId: string, targetFolioId: string, departments: string[]) =>
      call<{ items: RoutingRule[] }>('POST', `${p}/folios/${id(folioId)}/routing-rules`, {
        targetFolioId,
        departments,
      }).then((r) => r.data.items),
    removeRoutingRule: (ruleId: string) =>
      call<void>('DELETE', `${p}/routing-rules/${id(ruleId)}`).then((r) => r.data),
    transfer: (folioId: string, targetFolioId: string, lineIds: string[], reason: string) =>
      call<Folio>('POST', `${p}/folios/${id(folioId)}/transfers`, {
        targetFolioId,
        lineIds,
        reason,
      }).then((r) => r.data),
    issueDocument: (folioId: string, body: IssueDocumentRequest) =>
      call<FolioDocument>('POST', `${p}/folios/${id(folioId)}/documents`, body).then((r) => r.data),
    documents: (folioId: string) =>
      call<{ items: FolioDocument[] }>('GET', `${p}/folios/${id(folioId)}/documents`).then(
        (r) => r.data.items,
      ),
    document: (documentId: string) =>
      call<FolioDocument>('GET', `${p}/documents/${id(documentId)}`).then((r) => r.data),
    cashierShift: () =>
      call<{ shift: CashierShift | null }>('GET', `${p}/cashier/shift`).then((r) => r.data.shift),
    openCashierShift: (openingFloatMinor: number) =>
      call<CashierShift>('POST', `${p}/cashier/shift`, { openingFloatMinor }).then((r) => r.data),
    closeCashierShift: (
      shiftId: string,
      version: number,
      countedCashMinor: number,
      notes: string,
    ) =>
      call<CashierShift>(
        'POST',
        `${p}/cashier/shifts/${id(shiftId)}/close`,
        { countedCashMinor, notes },
        { 'if-match': `W/"${version}"` },
      ).then((r) => r.data),
    cashierShifts: () =>
      call<{ items: CashierShift[] }>('GET', `${p}/cashier/shifts`).then((r) => r.data.items),
    dailyReport: (date?: string) =>
      call<DailyReport>('GET', `${p}/reports/daily${qs({ date })}`).then((r) => r.data),
    reconciliation: () =>
      call<Reconciliation>('GET', `${p}/reports/reconciliation`).then((r) => r.data),
    reconciliationRuns: () =>
      call<{ items: ReconciliationRun[] }>('GET', `${p}/reports/reconciliation-runs`).then(
        (r) => r.data.items,
      ),
  };
}
