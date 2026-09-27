-- AlterEnum
ALTER TYPE "PaymentIntentStatus" ADD VALUE 'AUTHORIZED';

-- AlterTable
ALTER TABLE "folios" ADD COLUMN     "discount_holder_name" TEXT,
ADD COLUMN     "discount_id_encrypted" BYTEA,
ADD COLUMN     "discount_id_last4" VARCHAR(4),
ADD COLUMN     "discount_profile_id" UUID;

-- AlterTable
ALTER TABLE "payment_intents" ADD COLUMN     "captured_minor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'PAYMENT',
ADD COLUMN     "reservation_room_id" UUID,
ALTER COLUMN "folio_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "exchange_rate_micros" BIGINT,
ADD COLUMN     "tendered_amount_minor" BIGINT,
ADD COLUMN     "tendered_currency" CHAR(3);

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "provider" TEXT;

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "rate_micros" BIGINT NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discount_bps" INTEGER NOT NULL,
    "exempt_tax_codes" TEXT[],
    "departments" TEXT[],
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exchange_rates_property_id_currency_effective_from_idx" ON "exchange_rates"("property_id", "currency", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_organization_id_id_key" ON "exchange_rates"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_profiles_organization_id_id_key" ON "discount_profiles"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_profiles_property_id_code_key" ON "discount_profiles"("property_id", "code");

-- CreateIndex
CREATE INDEX "payment_intents_organization_id_reservation_room_id_idx" ON "payment_intents"("organization_id", "reservation_room_id");

-- AddForeignKey
ALTER TABLE "folios" ADD CONSTRAINT "folios_organization_id_discount_profile_id_fkey" FOREIGN KEY ("organization_id", "discount_profile_id") REFERENCES "discount_profiles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =======================================================================================
-- Hand-written: integrity rules, privileges and row-level security
-- =======================================================================================

-- ---- Card holds -------------------------------------------------------------------------
ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_kind CHECK (kind IN ('PAYMENT', 'HOLD')),
  ADD CONSTRAINT payment_intents_target CHECK (folio_id IS NOT NULL OR reservation_room_id IS NOT NULL),
  ADD CONSTRAINT payment_intents_captured CHECK (captured_minor >= 0 AND captured_minor <= amount_minor);
GRANT UPDATE (captured_minor, folio_id) ON payment_intents TO app_rw;

-- ---- Asynchronous refunds: found by provider reference, like payment intents -----------
CREATE POLICY by_provider_ref ON refunds FOR SELECT TO app_rw
  USING (provider || ':' || provider_ref = app.current_payment_ref());
GRANT UPDATE (provider) ON refunds TO app_rw;

-- ---- Foreign cash -------------------------------------------------------------------------
ALTER TABLE payments
  ADD CONSTRAINT payments_tendered CHECK (
    (tendered_currency IS NULL) = (tendered_amount_minor IS NULL)
    AND (tendered_currency IS NULL) = (exchange_rate_micros IS NULL)
    AND (tendered_amount_minor IS NULL OR tendered_amount_minor > 0)
    AND (exchange_rate_micros IS NULL OR exchange_rate_micros > 0)
  );
ALTER TABLE exchange_rates
  ADD CONSTRAINT exchange_rates_rate CHECK (rate_micros > 0),
  ADD CONSTRAINT exchange_rates_currency_iso CHECK (currency ~ '^[A-Z]{3}$');
CREATE TRIGGER exchange_rates_append_only
  BEFORE UPDATE OR DELETE ON exchange_rates
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- ---- Statutory discounts ------------------------------------------------------------------
ALTER TABLE discount_profiles
  ADD CONSTRAINT discount_profiles_bps CHECK (discount_bps BETWEEN 0 AND 10000),
  ADD CONSTRAINT discount_profiles_departments CHECK (cardinality(departments) > 0);
ALTER TABLE folios
  ADD CONSTRAINT folios_discount_complete CHECK (
    (discount_profile_id IS NULL) = (discount_holder_name IS NULL)
    AND (discount_profile_id IS NULL) = (discount_id_encrypted IS NULL)
    AND (discount_profile_id IS NULL) = (discount_id_last4 IS NULL)
  );
GRANT UPDATE (discount_profile_id, discount_holder_name, discount_id_last4, discount_id_encrypted)
  ON folios TO app_rw;

-- ---- Privileges and row-level security ----------------------------------------------------
GRANT SELECT, INSERT ON exchange_rates TO app_rw;
GRANT SELECT, INSERT, UPDATE (name, discount_bps, exempt_tax_codes, departments, archived_at)
  ON discount_profiles TO app_rw;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exchange_rates', 'discount_profiles'] LOOP
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
