-- CreateEnum
CREATE TYPE "FolioStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "FolioLineType" AS ENUM ('CHARGE', 'TAX', 'PAYMENT', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'EWALLET', 'OTHER');

-- CreateEnum
CREATE TYPE "HousekeepingTaskType" AS ENUM ('CHECKOUT_CLEAN', 'STAYOVER', 'TOUCH_UP', 'INSPECTION');

-- CreateEnum
CREATE TYPE "HousekeepingTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "stays" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "reservation_room_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "checked_in_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_in_by" UUID,
    "checked_out_at" TIMESTAMPTZ(3),
    "checked_out_by" UUID,

    CONSTRAINT "stays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "inclusive" BOOLEAN NOT NULL,
    "departments" TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folios" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "folio_no" TEXT NOT NULL,
    "reservation_room_id" UUID,
    "status" "FolioStatus" NOT NULL DEFAULT 'OPEN',
    "currency" CHAR(3) NOT NULL,
    "balance_minor" BIGINT NOT NULL DEFAULT 0,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "folios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folio_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "folio_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "type" "FolioLineType" NOT NULL,
    "department" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "parent_line_id" UUID,
    "reverses_line_id" UUID,
    "tax_code" TEXT,
    "source_key" TEXT,
    "reason" TEXT,
    "posted_by" UUID,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folio_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "folio_id" UUID NOT NULL,
    "folio_line_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reference" TEXT,
    "business_date" DATE NOT NULL,
    "received_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "housekeeping_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "type" "HousekeepingTaskType" NOT NULL,
    "status" "HousekeepingTaskStatus" NOT NULL DEFAULT 'OPEN',
    "business_date" DATE NOT NULL,
    "assigned_membership_id" UUID,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "housekeeping_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_day_closings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by" UUID,
    "stats" JSONB NOT NULL,

    CONSTRAINT "business_day_closings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stays_reservation_room_id_key" ON "stays"("reservation_room_id");

-- CreateIndex
CREATE INDEX "stays_organization_id_property_id_checked_out_at_idx" ON "stays"("organization_id", "property_id", "checked_out_at");

-- CreateIndex
CREATE UNIQUE INDEX "stays_organization_id_id_key" ON "stays"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rules_organization_id_id_key" ON "tax_rules"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rules_property_id_code_key" ON "tax_rules"("property_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "folios_organization_id_id_key" ON "folios"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "folios_property_id_folio_no_key" ON "folios"("property_id", "folio_no");

-- CreateIndex
CREATE INDEX "folio_lines_organization_id_folio_id_posted_at_idx" ON "folio_lines"("organization_id", "folio_id", "posted_at");

-- CreateIndex
CREATE INDEX "folio_lines_organization_id_property_id_business_date_idx" ON "folio_lines"("organization_id", "property_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "folio_lines_organization_id_id_key" ON "folio_lines"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "folio_lines_folio_id_source_key_key" ON "folio_lines"("folio_id", "source_key");

-- CreateIndex
CREATE INDEX "payments_organization_id_property_id_business_date_idx" ON "payments"("organization_id", "property_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_id_key" ON "payments"("organization_id", "id");

-- CreateIndex
CREATE INDEX "housekeeping_tasks_organization_id_property_id_business_dat_idx" ON "housekeeping_tasks"("organization_id", "property_id", "business_date");

-- CreateIndex
CREATE INDEX "housekeeping_tasks_organization_id_assigned_membership_id_s_idx" ON "housekeeping_tasks"("organization_id", "assigned_membership_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "housekeeping_tasks_organization_id_id_key" ON "housekeeping_tasks"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "business_day_closings_organization_id_id_key" ON "business_day_closings"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "business_day_closings_property_id_business_date_key" ON "business_day_closings"("property_id", "business_date");

-- AddForeignKey
ALTER TABLE "stays" ADD CONSTRAINT "stays_organization_id_reservation_room_id_fkey" FOREIGN KEY ("organization_id", "reservation_room_id") REFERENCES "reservation_rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stays" ADD CONSTRAINT "stays_organization_id_room_id_fkey" FOREIGN KEY ("organization_id", "room_id") REFERENCES "rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folios" ADD CONSTRAINT "folios_organization_id_reservation_room_id_fkey" FOREIGN KEY ("organization_id", "reservation_room_id") REFERENCES "reservation_rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folio_lines" ADD CONSTRAINT "folio_lines_organization_id_folio_id_fkey" FOREIGN KEY ("organization_id", "folio_id") REFERENCES "folios"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_folio_id_fkey" FOREIGN KEY ("organization_id", "folio_id") REFERENCES "folios"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_organization_id_room_id_fkey" FOREIGN KEY ("organization_id", "room_id") REFERENCES "rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_organization_id_assigned_membership_id_fkey" FOREIGN KEY ("organization_id", "assigned_membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_day_closings" ADD CONSTRAINT "business_day_closings_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =======================================================================================
-- Hand-written: integrity rules, ledger triggers, privileges and row-level security
-- =======================================================================================

-- ---- Integrity ------------------------------------------------------------------------
ALTER TABLE tax_rules
  ADD CONSTRAINT tax_rules_rate CHECK (rate_bps >= 0 AND rate_bps <= 10000),
  ADD CONSTRAINT tax_rules_departments CHECK (cardinality(departments) > 0);

ALTER TABLE folio_lines
  ADD CONSTRAINT folio_lines_currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
  -- Sign discipline: the ledger can be read without knowing application code.
  ADD CONSTRAINT folio_lines_sign CHECK (
    (type IN ('CHARGE', 'TAX') AND amount_minor > 0)
    OR (type = 'PAYMENT' AND amount_minor < 0)
    OR (type IN ('ADJUSTMENT', 'REVERSAL') AND amount_minor <> 0)
  ),
  ADD CONSTRAINT folio_lines_reversal_target CHECK ((type = 'REVERSAL') = (reverses_line_id IS NOT NULL));

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount_minor > 0);

-- One folio per booked room; one open task per room and task type.
CREATE UNIQUE INDEX folios_one_per_reservation_room
  ON folios (reservation_room_id) WHERE reservation_room_id IS NOT NULL;
CREATE UNIQUE INDEX housekeeping_tasks_one_open_per_room_type
  ON housekeeping_tasks (room_id, type) WHERE status IN ('OPEN', 'IN_PROGRESS');
-- A line can be reversed once.
CREATE UNIQUE INDEX folio_lines_reversed_once
  ON folio_lines (reverses_line_id) WHERE reverses_line_id IS NOT NULL;

-- ---- Ledger triggers --------------------------------------------------------------------
-- Postings go only to open folios, and the cached balance is maintained by the database in
-- the same statement, so it can never drift from SUM(amount_minor).
CREATE FUNCTION app.folio_line_posted() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  folio_status text;
  folio_currency text;
BEGIN
  SELECT status::text, currency INTO folio_status, folio_currency
  FROM folios WHERE id = NEW.folio_id FOR UPDATE;
  IF folio_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'folio % is not open', NEW.folio_id USING ERRCODE = 'check_violation',
      CONSTRAINT = 'folio_lines_folio_open';
  END IF;
  IF NEW.currency <> folio_currency THEN
    RAISE EXCEPTION 'line currency % differs from folio currency %', NEW.currency, folio_currency
      USING ERRCODE = 'check_violation', CONSTRAINT = 'folio_lines_currency_matches';
  END IF;
  UPDATE folios SET balance_minor = balance_minor + NEW.amount_minor WHERE id = NEW.folio_id;
  RETURN NEW;
END
$$;

CREATE TRIGGER folio_lines_posted
  AFTER INSERT ON folio_lines
  FOR EACH ROW EXECUTE FUNCTION app.folio_line_posted();

CREATE TRIGGER folio_lines_append_only
  BEFORE UPDATE OR DELETE ON folio_lines
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER payments_append_only
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER business_day_closings_append_only
  BEFORE UPDATE OR DELETE ON business_day_closings
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- ---- Privileges -----------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE (room_id, checked_out_at, checked_out_by) ON stays TO app_rw;
GRANT SELECT, INSERT, UPDATE (archived_at) ON tax_rules TO app_rw;
-- balance_minor is written only by the trigger above (which runs as the posting role).
GRANT SELECT, INSERT, UPDATE (status, closed_at, balance_minor, version) ON folios TO app_rw;
GRANT SELECT, INSERT ON folio_lines, payments, business_day_closings TO app_rw;
GRANT SELECT, INSERT, UPDATE ON housekeeping_tasks TO app_rw;
-- Night audit writes rooms' housekeeping status (already granted) and the business date.
GRANT UPDATE (current_business_date) ON properties TO app_rw;

-- ---- Row-level security ---------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stays', 'tax_rules', 'folios', 'folio_lines', 'payments', 'housekeeping_tasks',
    'business_day_closings'
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
