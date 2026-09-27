-- AlterTable
ALTER TABLE "leave_ledger" ADD COLUMN     "accrual_period" VARCHAR(7);

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "approval_step" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "approvals_required" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "leave_types" ADD COLUMN     "accrual_half_days_per_month" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hr_approval_required" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "run_date" DATE NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "issues" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_approvals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "leave_request_id" UUID NOT NULL,
    "step" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "decided_by" UUID,
    "note" TEXT,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_runs_organization_id_id_key" ON "reconciliation_runs"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_runs_property_id_run_date_key" ON "reconciliation_runs"("property_id", "run_date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_approvals_organization_id_id_key" ON "leave_approvals"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_approvals_leave_request_id_step_key" ON "leave_approvals"("leave_request_id", "step");

-- AddForeignKey
ALTER TABLE "leave_approvals" ADD CONSTRAINT "leave_approvals_organization_id_leave_request_id_fkey" FOREIGN KEY ("organization_id", "leave_request_id") REFERENCES "leave_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =======================================================================================
-- Hand-written: integrity rules, privileges and row-level security
-- =======================================================================================

ALTER TABLE leave_types
  ADD CONSTRAINT leave_types_accrual CHECK (accrual_half_days_per_month BETWEEN 0 AND 20);
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_steps CHECK (
    approvals_required IN (1, 2) AND approval_step BETWEEN 1 AND approvals_required
  );
ALTER TABLE leave_approvals
  ADD CONSTRAINT leave_approvals_decision CHECK (decision IN ('APPROVE', 'REJECT'));
CREATE TRIGGER leave_approvals_append_only
  BEFORE UPDATE OR DELETE ON leave_approvals
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- A scheduled accrual is posted once per employee, leave type and month.
ALTER TABLE leave_ledger
  ADD CONSTRAINT leave_ledger_accrual_period CHECK (
    accrual_period IS NULL OR (kind = 'ACCRUAL' AND accrual_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
  );
CREATE UNIQUE INDEX leave_ledger_one_accrual_per_period
  ON leave_ledger (employee_id, leave_type_id, accrual_period) WHERE accrual_period IS NOT NULL;

-- ---- Privileges -----------------------------------------------------------------------
GRANT UPDATE (approval_step) ON leave_requests TO app_rw;
GRANT SELECT, INSERT ON leave_approvals, reconciliation_runs TO app_rw;

-- The scheduler (worker, app_system) plans jobs by local time: it may read which
-- properties and organizations exist, their time zones and status. Nothing else.
GRANT SELECT (id, organization_id, timezone, status) ON properties TO app_system;
CREATE POLICY scheduler_read ON properties FOR SELECT TO app_system USING (true);
GRANT SELECT (id, default_timezone, status) ON organizations TO app_system;
CREATE POLICY scheduler_read ON organizations FOR SELECT TO app_system USING (true);

-- ---- Row-level security ---------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_approvals', 'reconciliation_runs'] LOOP
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
