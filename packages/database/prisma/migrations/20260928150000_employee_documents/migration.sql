-- CreateTable
CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "expires_on" DATE,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_documents_organization_id_employee_id_idx" ON "employee_documents"("organization_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_documents_organization_id_id_key" ON "employee_documents"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_documents_storage_key_key" ON "employee_documents"("storage_key");

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- =======================================================================================
-- Hand-written: integrity rules, privileges and row-level security
-- =======================================================================================

ALTER TABLE employee_documents
  ADD CONSTRAINT employee_documents_category CHECK (
    category IN ('CONTRACT', 'GOVERNMENT_ID', 'TAX', 'MEDICAL', 'CERTIFICATE', 'OTHER')
  ),
  ADD CONSTRAINT employee_documents_content_type CHECK (
    content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ),
  ADD CONSTRAINT employee_documents_size CHECK (size_bytes BETWEEN 1 AND 8388608),
  ADD CONSTRAINT employee_documents_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT employee_documents_deleted CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));

-- Metadata is written once; only deletion (soft) changes a row.
GRANT SELECT, INSERT, UPDATE (deleted_at, deleted_by) ON employee_documents TO app_rw;

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_documents TO app_rw
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());
