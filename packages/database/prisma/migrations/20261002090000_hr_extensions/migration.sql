-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "emergency_contact_name" TEXT,
ADD COLUMN     "emergency_contact_phone" TEXT,
ADD COLUMN     "emergency_contact_relationship" TEXT,
ADD COLUMN     "employment_type" TEXT NOT NULL DEFAULT 'FULL_TIME';

-- AlterTable
ALTER TABLE "shifts" ADD COLUMN     "series_id" UUID;

-- CreateTable
CREATE TABLE "employee_compensations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "pay_basis" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "employee_compensations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_trainings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "completed_on" DATE,
    "expires_on" DATE,
    "notes" TEXT NOT NULL DEFAULT '',
    "document_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "employee_trainings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_reviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "review_date" DATE NOT NULL,
    "period_from" DATE,
    "period_to" DATE,
    "rating" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "strengths" TEXT NOT NULL DEFAULT '',
    "improvements" TEXT NOT NULL DEFAULT '',
    "goals" TEXT NOT NULL DEFAULT '',
    "reviewer_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staffing_requirements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "weekdays" INTEGER[],
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "min_staff" INTEGER NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "staffing_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_compensations_organization_id_employee_id_effectiv_idx" ON "employee_compensations"("organization_id", "employee_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "employee_compensations_organization_id_id_key" ON "employee_compensations"("organization_id", "id");

-- CreateIndex
CREATE INDEX "employee_trainings_organization_id_employee_id_idx" ON "employee_trainings"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_trainings_organization_id_expires_on_idx" ON "employee_trainings"("organization_id", "expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "employee_trainings_organization_id_id_key" ON "employee_trainings"("organization_id", "id");

-- CreateIndex
CREATE INDEX "employee_reviews_organization_id_employee_id_review_date_idx" ON "employee_reviews"("organization_id", "employee_id", "review_date");

-- CreateIndex
CREATE UNIQUE INDEX "employee_reviews_organization_id_id_key" ON "employee_reviews"("organization_id", "id");

-- CreateIndex
CREATE INDEX "staffing_requirements_organization_id_property_id_idx" ON "staffing_requirements"("organization_id", "property_id");

-- CreateIndex
CREATE UNIQUE INDEX "staffing_requirements_organization_id_id_key" ON "staffing_requirements"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "employee_compensations" ADD CONSTRAINT "employee_compensations_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_trainings" ADD CONSTRAINT "employee_trainings_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_reviews" ADD CONSTRAINT "employee_reviews_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staffing_requirements" ADD CONSTRAINT "staffing_requirements_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staffing_requirements" ADD CONSTRAINT "staffing_requirements_organization_id_department_id_fkey" FOREIGN KEY ("organization_id", "department_id") REFERENCES "departments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =======================================================================================
-- Hand-written (ADR-0028)
-- =======================================================================================

ALTER TABLE employees
  ADD CONSTRAINT employees_employment_type CHECK (
    employment_type IN ('FULL_TIME', 'PART_TIME', 'PROBATIONARY', 'CONTRACTUAL', 'SEASONAL',
                        'INTERN')
  );

ALTER TABLE employee_compensations
  ADD CONSTRAINT employee_compensations_pay_basis CHECK (pay_basis IN ('MONTHLY', 'DAILY', 'HOURLY')),
  ADD CONSTRAINT employee_compensations_amount CHECK (amount_minor >= 0);

ALTER TABLE employee_trainings
  ADD CONSTRAINT employee_trainings_kind CHECK (kind IN ('TRAINING', 'CERTIFICATION')),
  ADD CONSTRAINT employee_trainings_dates CHECK (
    completed_on IS NULL OR expires_on IS NULL OR expires_on >= completed_on
  );

ALTER TABLE employee_reviews
  ADD CONSTRAINT employee_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  ADD CONSTRAINT employee_reviews_period CHECK (
    period_from IS NULL OR period_to IS NULL OR period_to >= period_from
  );

ALTER TABLE staffing_requirements
  ADD CONSTRAINT staffing_requirements_weekdays CHECK (
    weekdays IS NOT NULL AND cardinality(weekdays) BETWEEN 1 AND 7
    AND weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]
  ),
  ADD CONSTRAINT staffing_requirements_min_staff CHECK (min_staff BETWEEN 1 AND 200),
  ADD CONSTRAINT staffing_requirements_window CHECK (start_time <> end_time);

CREATE INDEX shifts_series_idx ON shifts (organization_id, series_id) WHERE series_id IS NOT NULL;

-- Pay and review records are never changed; mistakes are corrected by a new record.
GRANT SELECT, INSERT ON employee_compensations, employee_reviews TO app_rw;
GRANT SELECT, INSERT, DELETE ON employee_trainings TO app_rw;
GRANT SELECT, INSERT, UPDATE (archived_at) ON staffing_requirements TO app_rw;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employee_compensations', 'employee_trainings', 'employee_reviews',
                           'staffing_requirements'] LOOP
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
