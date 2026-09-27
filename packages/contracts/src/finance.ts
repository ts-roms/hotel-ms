import { z } from 'zod';
import { localDateSchema } from './common.js';
import { DEPARTMENTS, PAYMENT_METHODS } from './front-office.js';

/**
 * Finance contracts (blueprint §15): online payments through a gateway, webhooks, refunds,
 * cashier shifts, invoices and receipts, folio routing and transfers, reports.
 */

const positiveMinor = z.number().int().min(1).max(10_000_000_000);

// ---- Online payments ------------------------------------------------------------------------

export const PAYMENT_INTENT_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
] as const;

export const paymentIntentSchema = z.object({
  id: z.uuid(),
  folioId: z.uuid(),
  provider: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  status: z.enum(PAYMENT_INTENT_STATUSES),
  /** Where the payer completes the payment (provider-hosted; no card data touches us). */
  checkoutUrl: z.string().nullable(),
  paymentId: z.uuid().nullable(),
  /** Succeeded at the provider but could not be posted (e.g. the folio had closed). */
  needsAttention: z.boolean(),
  failureReason: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

export const createPaymentLinkRequestSchema = z.strictObject({
  amountMinor: positiveMinor,
});
export type CreatePaymentLinkRequest = z.infer<typeof createPaymentLinkRequestSchema>;

export const guestPaymentRequestSchema = z.strictObject({
  /** Defaults to the current balance. */
  amountMinor: positiveMinor.optional(),
});
export type GuestPaymentRequest = z.infer<typeof guestPaymentRequestSchema>;

// ---- Refunds -------------------------------------------------------------------------------

export const refundSchema = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  amountMinor: z.number().int(),
  method: z.enum(PAYMENT_METHODS),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']),
  reason: z.string(),
  createdAt: z.iso.datetime(),
});
export type Refund = z.infer<typeof refundSchema>;

export const refundRequestSchema = z.strictObject({
  amountMinor: positiveMinor,
  reason: z.string().trim().min(3).max(200),
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;

// ---- Cashier shifts -----------------------------------------------------------------------

export const cashierShiftSchema = z.object({
  id: z.uuid(),
  cashierName: z.string(),
  status: z.enum(['OPEN', 'CLOSED']),
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  openingFloatMinor: z.number().int(),
  cashInMinor: z.number().int(),
  cashOutMinor: z.number().int(),
  /** Float + cash payments − cash refunds. */
  expectedCashMinor: z.number().int(),
  countedCashMinor: z.number().int().nullable(),
  varianceMinor: z.number().int().nullable(),
  notes: z.string(),
  version: z.number().int(),
});
export type CashierShift = z.infer<typeof cashierShiftSchema>;

export const openShiftRequestSchema = z.strictObject({
  openingFloatMinor: z.number().int().min(0).max(1_000_000_000),
});
export type OpenShiftRequest = z.infer<typeof openShiftRequestSchema>;

export const closeShiftRequestSchema = z.strictObject({
  countedCashMinor: z.number().int().min(0).max(10_000_000_000),
  notes: z.string().trim().max(500).default(''),
});
export type CloseShiftRequest = z.infer<typeof closeShiftRequestSchema>;

// ---- Documents -----------------------------------------------------------------------------

export const DOCUMENT_TYPES = ['INVOICE', 'RECEIPT'] as const;

export const folioDocumentSchema = z.object({
  id: z.uuid(),
  folioId: z.uuid(),
  type: z.enum(DOCUMENT_TYPES),
  documentNo: z.string(),
  paymentId: z.uuid().nullable(),
  issuedAt: z.iso.datetime(),
  currency: z.string(),
  totalMinor: z.number().int(),
  /** Frozen content: property, guest, lines, tax summary and totals as issued. */
  content: z.object({
    property: z.object({ name: z.string(), address: z.string().nullable() }),
    billTo: z.string(),
    folioNo: z.string(),
    lines: z.array(
      z.object({
        date: localDateSchema,
        type: z.string(),
        description: z.string(),
        amountMinor: z.number().int(),
      }),
    ),
    taxes: z.array(z.object({ code: z.string(), name: z.string(), amountMinor: z.number().int() })),
    totals: z.object({
      chargesMinor: z.number().int(),
      paymentsMinor: z.number().int(),
      balanceMinor: z.number().int(),
    }),
    payment: z
      .object({
        method: z.string(),
        amountMinor: z.number().int(),
        reference: z.string().nullable(),
      })
      .nullable(),
  }),
});
export type FolioDocument = z.infer<typeof folioDocumentSchema>;

export const issueDocumentRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('INVOICE') }),
  z.strictObject({ type: z.literal('RECEIPT'), paymentId: z.uuid() }),
]);
export type IssueDocumentRequest = z.infer<typeof issueDocumentRequestSchema>;

// ---- Accounts, routing and transfers ---------------------------------------------------

export const createAccountFolioRequestSchema = z.strictObject({
  /** Company, travel agent or group master account name. */
  label: z.string().trim().min(1).max(100),
});
export type CreateAccountFolioRequest = z.infer<typeof createAccountFolioRequestSchema>;

export const accountFolioSchema = z.object({
  id: z.uuid(),
  folioNo: z.string(),
  label: z.string(),
  status: z.enum(['OPEN', 'CLOSED']),
  balanceMinor: z.number().int(),
});
export type AccountFolio = z.infer<typeof accountFolioSchema>;

export const routingRuleSchema = z.object({
  id: z.uuid(),
  sourceFolioId: z.uuid(),
  targetFolioId: z.uuid(),
  targetFolioNo: z.string(),
  targetLabel: z.string().nullable(),
  departments: z.array(z.enum(DEPARTMENTS)),
});
export type RoutingRule = z.infer<typeof routingRuleSchema>;

export const createRoutingRuleRequestSchema = z.strictObject({
  targetFolioId: z.uuid(),
  departments: z.array(z.enum(DEPARTMENTS)).min(1),
});
export type CreateRoutingRuleRequest = z.infer<typeof createRoutingRuleRequestSchema>;

export const transferRequestSchema = z.strictObject({
  targetFolioId: z.uuid(),
  /** CHARGE lines to move (their taxes move with them). */
  lineIds: z.array(z.uuid()).min(1).max(100),
  reason: z.string().trim().min(3).max(200),
});
export type TransferRequest = z.infer<typeof transferRequestSchema>;

// ---- Reports -------------------------------------------------------------------------------

export const dailyReportSchema = z.object({
  businessDate: localDateSchema,
  currency: z.string(),
  revenue: z.array(z.object({ department: z.string(), netMinor: z.number().int() })),
  taxes: z.array(z.object({ code: z.string(), amountMinor: z.number().int() })),
  payments: z.array(
    z.object({ method: z.string(), amountMinor: z.number().int(), count: z.number().int() }),
  ),
  refunds: z.array(
    z.object({ method: z.string(), amountMinor: z.number().int(), count: z.number().int() }),
  ),
  totals: z.object({
    revenueNetMinor: z.number().int(),
    taxMinor: z.number().int(),
    paymentsMinor: z.number().int(),
    refundsMinor: z.number().int(),
  }),
  /** Sum of open folio balances (guests in house plus company accounts). */
  outstandingMinor: z.number().int(),
});
export type DailyReport = z.infer<typeof dailyReportSchema>;

export const reconciliationSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.iso.datetime(),
  issues: z.array(
    z.object({
      code: z.enum([
        'FOLIO_BALANCE_MISMATCH',
        'PAYMENT_WITHOUT_LINE',
        'UNAPPLIED_ONLINE_PAYMENT',
        'STALE_PAYMENT_INTENT',
        'STALE_CASHIER_SHIFT',
        'PENDING_REFUND',
      ]),
      message: z.string(),
      reference: z.string(),
    }),
  ),
});
export type Reconciliation = z.infer<typeof reconciliationSchema>;

/** The nightly automatic reconciliation, one run per property and local date. */
export const reconciliationRunSchema = z.object({
  id: z.uuid(),
  runDate: localDateSchema,
  ok: z.boolean(),
  issues: reconciliationSchema.shape.issues,
  createdAt: z.iso.datetime(),
});
export type ReconciliationRun = z.infer<typeof reconciliationRunSchema>;

export const dailyReportQuerySchema = z.object({ date: localDateSchema.optional() });
export type DailyReportQuery = z.infer<typeof dailyReportQuerySchema>;
