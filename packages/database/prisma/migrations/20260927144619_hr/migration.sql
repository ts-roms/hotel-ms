-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "BirthdayVisibility" AS ENUM ('DAY_MONTH', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PunchType" AS ENUM ('IN', 'OUT', 'BREAK_START', 'BREAK_END');

-- CreateEnum
CREATE TYPE "PunchSource" AS ENUM ('WEB', 'KIOSK', 'CORRECTION');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaveLedgerKind" AS ENUM ('ACCRUAL', 'USAGE', 'ADJUSTMENT', 'REVERSAL');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_no" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "preferred_name" TEXT,
    "work_email" TEXT,
    "work_phone" TEXT,
    "personal_email" TEXT,
    "personal_phone" TEXT,
    "birth_date" DATE,
    "birthday_visibility" "BirthdayVisibility" NOT NULL DEFAULT 'HIDDEN',
    "hire_date" DATE NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "terminated_on" DATE,
    "membership_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "position_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "employment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "department_id" UUID,
    "name" TEXT NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "break_minutes" INTEGER NOT NULL DEFAULT 60,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "template_id" UUID,
    "shift_date" DATE NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "break_minutes" INTEGER NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT NOT NULL DEFAULT '',
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_punches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" "PunchType" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "source" "PunchSource" NOT NULL,
    "correction_id" UUID,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" "PunchType" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "allow_negative" BOOLEAN NOT NULL DEFAULT false,
    "min_notice_days" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_ledger" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "kind" "LeaveLedgerKind" NOT NULL,
    "half_days" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "leave_request_id" UUID,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "half_days" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("employee_id","leave_type_id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "half_days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_id_key" ON "departments"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_code_key" ON "departments"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "positions_organization_id_id_key" ON "positions"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "positions_organization_id_code_key" ON "positions"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_id_key" ON "employees"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_employee_no_key" ON "employees"("organization_id", "employee_no");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_membership_id_key" ON "employees"("organization_id", "membership_id");

-- CreateIndex
CREATE INDEX "employment_assignments_organization_id_property_id_idx" ON "employment_assignments"("organization_id", "property_id");

-- CreateIndex
CREATE INDEX "employment_assignments_organization_id_employee_id_idx" ON "employment_assignments"("organization_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employment_assignments_organization_id_id_key" ON "employment_assignments"("organization_id", "id");

-- CreateIndex
CREATE INDEX "shift_templates_organization_id_property_id_idx" ON "shift_templates"("organization_id", "property_id");

-- CreateIndex
CREATE UNIQUE INDEX "shift_templates_organization_id_id_key" ON "shift_templates"("organization_id", "id");

-- CreateIndex
CREATE INDEX "shifts_organization_id_property_id_shift_date_idx" ON "shifts"("organization_id", "property_id", "shift_date");

-- CreateIndex
CREATE INDEX "shifts_organization_id_employee_id_shift_date_idx" ON "shifts"("organization_id", "employee_id", "shift_date");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_organization_id_id_key" ON "shifts"("organization_id", "id");

-- CreateIndex
CREATE INDEX "attendance_punches_organization_id_employee_id_at_idx" ON "attendance_punches"("organization_id", "employee_id", "at");

-- CreateIndex
CREATE INDEX "attendance_punches_organization_id_property_id_at_idx" ON "attendance_punches"("organization_id", "property_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_punches_organization_id_id_key" ON "attendance_punches"("organization_id", "id");

-- CreateIndex
CREATE INDEX "attendance_corrections_organization_id_property_id_status_idx" ON "attendance_corrections"("organization_id", "property_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_corrections_organization_id_id_key" ON "attendance_corrections"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_organization_id_id_key" ON "leave_types"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_organization_id_code_key" ON "leave_types"("organization_id", "code");

-- CreateIndex
CREATE INDEX "leave_ledger_organization_id_employee_id_leave_type_id_idx" ON "leave_ledger"("organization_id", "employee_id", "leave_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_ledger_organization_id_id_key" ON "leave_ledger"("organization_id", "id");

-- CreateIndex
CREATE INDEX "leave_requests_organization_id_property_id_status_idx" ON "leave_requests"("organization_id", "property_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_organization_id_employee_id_start_date_idx" ON "leave_requests"("organization_id", "employee_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_requests_organization_id_id_key" ON "leave_requests"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_organization_id_department_id_fkey" FOREIGN KEY ("organization_id", "department_id") REFERENCES "departments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_organization_id_department_id_fkey" FOREIGN KEY ("organization_id", "department_id") REFERENCES "departments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_organization_id_position_id_fkey" FOREIGN KEY ("organization_id", "position_id") REFERENCES "positions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_organization_id_department_id_fkey" FOREIGN KEY ("organization_id", "department_id") REFERENCES "departments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_organization_id_department_id_fkey" FOREIGN KEY ("organization_id", "department_id") REFERENCES "departments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_organization_id_leave_type_id_fkey" FOREIGN KEY ("organization_id", "leave_type_id") REFERENCES "leave_types"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_organization_id_leave_type_id_fkey" FOREIGN KEY ("organization_id", "leave_type_id") REFERENCES "leave_types"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_organization_id_leave_type_id_fkey" FOREIGN KEY ("organization_id", "leave_type_id") REFERENCES "leave_types"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =======================================================================================
-- Hand-written: integrity rules, ledger triggers, privileges and row-level security
-- =======================================================================================

-- ---- Integrity ------------------------------------------------------------------------
ALTER TABLE employment_assignments
  ADD CONSTRAINT employment_assignments_dates CHECK (end_date IS NULL OR end_date >= start_date),
  -- One assignment per employee and property at any time (positions change by ending one
  -- assignment and starting the next).
  ADD CONSTRAINT employment_assignments_no_overlap EXCLUDE USING gist (
    employee_id WITH =,
    property_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  );
-- At most one open primary assignment per employee.
CREATE UNIQUE INDEX employment_assignments_one_primary
  ON employment_assignments (employee_id) WHERE is_primary AND end_date IS NULL;

ALTER TABLE shift_templates
  ADD CONSTRAINT shift_templates_times CHECK (
    start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND start_time <> end_time
  ),
  ADD CONSTRAINT shift_templates_break CHECK (break_minutes BETWEEN 0 AND 240);

ALTER TABLE shifts
  ADD CONSTRAINT shifts_times CHECK (
    ends_at > starts_at AND ends_at - starts_at <= interval '16 hours'
  ),
  ADD CONSTRAINT shifts_break CHECK (
    break_minutes >= 0 AND make_interval(mins => break_minutes) < ends_at - starts_at
  ),
  -- An employee cannot be in two shifts at once (blueprint §13.3).
  ADD CONSTRAINT shifts_no_overlap EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'CANCELLED');

ALTER TABLE leave_types
  ADD CONSTRAINT leave_types_notice CHECK (min_notice_days BETWEEN 0 AND 365);

ALTER TABLE leave_ledger
  -- Sign discipline, as in the folio ledger.
  ADD CONSTRAINT leave_ledger_sign CHECK (
    (kind IN ('ACCRUAL', 'REVERSAL') AND half_days > 0)
    OR (kind = 'USAGE' AND half_days < 0)
    OR (kind = 'ADJUSTMENT' AND half_days <> 0)
  ),
  ADD CONSTRAINT leave_ledger_request_link CHECK (
    (kind IN ('USAGE', 'REVERSAL')) = (leave_request_id IS NOT NULL)
  );
-- A request is debited once and given back at most once.
CREATE UNIQUE INDEX leave_ledger_one_per_request_kind
  ON leave_ledger (leave_request_id, kind) WHERE leave_request_id IS NOT NULL;

ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_dates CHECK (end_date >= start_date),
  ADD CONSTRAINT leave_requests_amount CHECK (half_days > 0);

-- ---- Ledger triggers ------------------------------------------------------------------
-- The cached balance is maintained in the posting statement, so it can never drift from
-- SUM(half_days). The row lock also serializes concurrent debits of one balance.
CREATE FUNCTION app.leave_ledger_posted() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  INSERT INTO leave_balances (organization_id, employee_id, leave_type_id, half_days, updated_at)
  VALUES (NEW.organization_id, NEW.employee_id, NEW.leave_type_id, NEW.half_days, now())
  ON CONFLICT (employee_id, leave_type_id)
  DO UPDATE SET half_days = leave_balances.half_days + EXCLUDED.half_days, updated_at = now();
  RETURN NEW;
END
$$;

CREATE TRIGGER leave_ledger_posted
  AFTER INSERT ON leave_ledger
  FOR EACH ROW EXECUTE FUNCTION app.leave_ledger_posted();

CREATE TRIGGER leave_ledger_append_only
  BEFORE UPDATE OR DELETE ON leave_ledger
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER attendance_punches_append_only
  BEFORE UPDATE OR DELETE ON attendance_punches
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- ---- Privileges -----------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE (name, archived_at) ON departments, positions TO app_rw;
GRANT SELECT, INSERT, UPDATE ON employees, shift_templates, shifts, leave_types TO app_rw;
GRANT SELECT, INSERT, UPDATE (end_date, is_primary) ON employment_assignments TO app_rw;
GRANT SELECT, INSERT ON attendance_punches, leave_ledger TO app_rw;
GRANT SELECT, INSERT, UPDATE (status, decided_by, decided_at, decision_note, version)
  ON attendance_corrections TO app_rw;
GRANT SELECT, INSERT, UPDATE (status, decided_by, decided_at, decision_note, cancelled_at, version)
  ON leave_requests TO app_rw;
-- half_days is written only by the ledger trigger (which runs as the posting role).
GRANT SELECT, INSERT, UPDATE (half_days, updated_at) ON leave_balances TO app_rw;

-- ---- Row-level security ---------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'departments', 'positions', 'employees', 'employment_assignments', 'shift_templates',
    'shifts', 'attendance_punches', 'attendance_corrections', 'leave_types', 'leave_ledger',
    'leave_balances', 'leave_requests'
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
