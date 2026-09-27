-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CashierShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "FolioDocumentType" AS ENUM ('INVOICE', 'RECEIPT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FolioLineType" ADD VALUE 'REFUND';
ALTER TYPE "FolioLineType" ADD VALUE 'TRANSFER';

-- AlterTable
ALTER TABLE "folio_lines" ADD COLUMN     "transfer_id" UUID;

-- AlterTable
ALTER TABLE "folios" ADD COLUMN     "label" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "cashier_shift_id" UUID,
ADD COLUMN     "intent_id" UUID,
ADD COLUMN     "provider" TEXT;

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "folio_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'PENDING',
    "checkout_url" TEXT,
    "return_url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_by" UUID,
    "guest_session_id" UUID,
    "payment_id" UUID,
    "needs_attention" BOOLEAN NOT NULL DEFAULT false,
    "failure_reason" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "folio_id" UUID NOT NULL,
    "folio_line_id" UUID,
    "amount_minor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL,
    "provider_ref" TEXT,
    "cashier_shift_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashier_shifts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "status" "CashierShiftStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_float_minor" BIGINT NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "expected_cash_minor" BIGINT,
    "counted_cash_minor" BIGINT,
    "variance_minor" BIGINT,
    "notes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cashier_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folio_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "folio_id" UUID NOT NULL,
    "type" "FolioDocumentType" NOT NULL,
    "document_no" TEXT NOT NULL,
    "payment_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "content" JSONB NOT NULL,
    "issued_by" UUID,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folio_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folio_routing_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "source_folio_id" UUID NOT NULL,
    "target_folio_id" UUID NOT NULL,
    "departments" TEXT[],
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "folio_routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_intents_organization_id_folio_id_idx" ON "payment_intents"("organization_id", "folio_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_organization_id_id_key" ON "payment_intents"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_provider_provider_ref_key" ON "payment_intents"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events"("provider", "event_id");

-- CreateIndex
CREATE INDEX "refunds_organization_id_payment_id_idx" ON "refunds"("organization_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_organization_id_id_key" ON "refunds"("organization_id", "id");

-- CreateIndex
CREATE INDEX "cashier_shifts_organization_id_property_id_status_idx" ON "cashier_shifts"("organization_id", "property_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cashier_shifts_organization_id_id_key" ON "cashier_shifts"("organization_id", "id");

-- CreateIndex
CREATE INDEX "folio_documents_organization_id_folio_id_idx" ON "folio_documents"("organization_id", "folio_id");

-- CreateIndex
CREATE UNIQUE INDEX "folio_documents_organization_id_id_key" ON "folio_documents"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "folio_documents_property_id_type_document_no_key" ON "folio_documents"("property_id", "type", "document_no");

-- CreateIndex
CREATE INDEX "folio_routing_rules_organization_id_source_folio_id_idx" ON "folio_routing_rules"("organization_id", "source_folio_id");

-- CreateIndex
CREATE UNIQUE INDEX "folio_routing_rules_organization_id_id_key" ON "folio_routing_rules"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_intent_id_key" ON "payments"("intent_id");

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_organization_id_folio_id_fkey" FOREIGN KEY ("organization_id", "folio_id") REFERENCES "folios"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organization_id_payment_id_fkey" FOREIGN KEY ("organization_id", "payment_id") REFERENCES "payments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folio_documents" ADD CONSTRAINT "folio_documents_organization_id_folio_id_fkey" FOREIGN KEY ("organization_id", "folio_id") REFERENCES "folios"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folio_routing_rules" ADD CONSTRAINT "folio_routing_rules_organization_id_source_folio_id_fkey" FOREIGN KEY ("organization_id", "source_folio_id") REFERENCES "folios"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folio_routing_rules" ADD CONSTRAINT "folio_routing_rules_organization_id_target_folio_id_fkey" FOREIGN KEY ("organization_id", "target_folio_id") REFERENCES "folios"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_cashier_shift_id_fkey" FOREIGN KEY ("organization_id", "cashier_shift_id") REFERENCES "cashier_shifts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =======================================================================================
-- Hand-written: ledger rules, lookup policy, privileges and row-level security
-- =======================================================================================

-- ---- Folio ledger: refunds and transfers -----------------------------------------------
-- Compared as text: enum values added in this migration cannot be used as literals yet.
ALTER TABLE folio_lines DROP CONSTRAINT folio_lines_sign;
ALTER TABLE folio_lines
  ADD CONSTRAINT folio_lines_sign CHECK (
    (type::text IN ('CHARGE', 'TAX') AND amount_minor > 0)
    OR (type::text = 'PAYMENT' AND amount_minor < 0)
    OR (type::text = 'REFUND' AND amount_minor > 0)
    OR (type::text IN ('ADJUSTMENT', 'REVERSAL', 'TRANSFER') AND amount_minor <> 0)
  ),
  ADD CONSTRAINT folio_lines_transfer_pair CHECK ((type::text = 'TRANSFER') = (transfer_id IS NOT NULL));
-- The source side of a transfer references the moved charge (so it moves once and can no
-- longer be voided); reversals must reference their original.
ALTER TABLE folio_lines DROP CONSTRAINT folio_lines_reversal_target;
ALTER TABLE folio_lines
  ADD CONSTRAINT folio_lines_reversal_target CHECK (
    (type::text <> 'REVERSAL' OR reverses_line_id IS NOT NULL)
    AND (type::text IN ('REVERSAL', 'TRANSFER') OR reverses_line_id IS NULL)
  );

-- ---- Payments ---------------------------------------------------------------------------
ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_amount CHECK (amount_minor > 0),
  ADD CONSTRAINT payment_intents_currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT payment_intents_source CHECK (source IN ('STAFF', 'GUEST'));
ALTER TABLE refunds ADD CONSTRAINT refunds_amount CHECK (amount_minor > 0);

-- ---- Cashier shifts -------------------------------------------------------------------
ALTER TABLE cashier_shifts
  ADD CONSTRAINT cashier_shifts_amounts CHECK (
    opening_float_minor >= 0 AND (counted_cash_minor IS NULL OR counted_cash_minor >= 0)
  ),
  ADD CONSTRAINT cashier_shifts_closed CHECK (
    (status = 'CLOSED') = (closed_at IS NOT NULL AND counted_cash_minor IS NOT NULL)
  );
-- One open drawer per cashier and property.
CREATE UNIQUE INDEX cashier_shifts_one_open
  ON cashier_shifts (membership_id, property_id) WHERE status = 'OPEN';

-- ---- Documents ------------------------------------------------------------------------
-- One receipt per payment.
CREATE UNIQUE INDEX folio_documents_one_receipt_per_payment
  ON folio_documents (payment_id) WHERE type = 'RECEIPT';
ALTER TABLE folio_documents
  ADD CONSTRAINT folio_documents_receipt_payment CHECK ((type = 'RECEIPT') = (payment_id IS NOT NULL));
CREATE TRIGGER folio_documents_append_only
  BEFORE UPDATE OR DELETE ON folio_documents
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

ALTER TABLE folio_routing_rules
  ADD CONSTRAINT folio_routing_rules_distinct CHECK (source_folio_id <> target_folio_id),
  ADD CONSTRAINT folio_routing_rules_departments CHECK (cardinality(departments) > 0);

-- ---- Webhook lookup: the provider reference identifies one intent ----------------------
CREATE FUNCTION app.current_payment_ref() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.payment_ref', true), '') $$;
GRANT EXECUTE ON FUNCTION app.current_payment_ref() TO app_rw;

-- ---- Privileges -----------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE (
  status, provider_ref, checkout_url, payment_id, needs_attention, failure_reason, updated_at
) ON payment_intents TO app_rw;
GRANT SELECT, INSERT, UPDATE (status, attempts, last_error, processed_at) ON webhook_events TO app_rw;
GRANT SELECT, INSERT, UPDATE (status, folio_line_id, provider_ref, completed_at) ON refunds TO app_rw;
GRANT SELECT, INSERT, UPDATE ON cashier_shifts TO app_rw;
GRANT SELECT, INSERT ON folio_documents TO app_rw;
GRANT SELECT, INSERT, UPDATE (removed_at) ON folio_routing_rules TO app_rw;

-- ---- Row-level security ---------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payment_intents', 'refunds', 'cashier_shifts', 'folio_documents', 'folio_routing_rules'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO app_rw '
      'USING (organization_id = app.current_org_id()) '
      'WITH CHECK (organization_id = app.current_org_id())',
      t
    );
  END LOOP;
END
$$;

-- Webhooks arrive without a tenant: exactly the intent named by "provider:ref" is visible.
CREATE POLICY by_provider_ref ON payment_intents FOR SELECT TO app_rw
  USING (provider || ':' || provider_ref = app.current_payment_ref());
