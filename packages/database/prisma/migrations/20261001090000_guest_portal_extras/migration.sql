-- CreateTable
CREATE TABLE "guest_identity_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "reservation_room_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by" UUID,
    "purged_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "guest_identity_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "reservation_room_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),
    "created_by" UUID,

    CONSTRAINT "guest_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guest_identity_documents_organization_id_property_id_status_idx" ON "guest_identity_documents"("organization_id", "property_id", "status");

-- CreateIndex
CREATE INDEX "guest_identity_documents_organization_id_reservation_room_i_idx" ON "guest_identity_documents"("organization_id", "reservation_room_id");

-- CreateIndex
CREATE UNIQUE INDEX "guest_identity_documents_organization_id_id_key" ON "guest_identity_documents"("organization_id", "id");

-- CreateIndex
CREATE INDEX "guest_notifications_organization_id_reservation_room_id_cre_idx" ON "guest_notifications"("organization_id", "reservation_room_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "guest_notifications_organization_id_id_key" ON "guest_notifications"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "guest_identity_documents" ADD CONSTRAINT "guest_identity_documents_organization_id_reservation_room__fkey" FOREIGN KEY ("organization_id", "reservation_room_id") REFERENCES "reservation_rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_identity_documents" ADD CONSTRAINT "guest_identity_documents_organization_id_guest_id_fkey" FOREIGN KEY ("organization_id", "guest_id") REFERENCES "guests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_notifications" ADD CONSTRAINT "guest_notifications_organization_id_reservation_room_id_fkey" FOREIGN KEY ("organization_id", "reservation_room_id") REFERENCES "reservation_rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =======================================================================================
-- Hand-written (ADR-0027)
-- =======================================================================================

ALTER TABLE guest_identity_documents
  ADD CONSTRAINT guest_identity_documents_type CHECK (
    document_type IN ('PASSPORT', 'DRIVERS_LICENSE', 'NATIONAL_ID', 'OTHER')
  ),
  ADD CONSTRAINT guest_identity_documents_status CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED')
  ),
  ADD CONSTRAINT guest_identity_documents_size CHECK (size_bytes > 0);

ALTER TABLE guest_notifications
  ADD CONSTRAINT guest_notifications_kind CHECK (
    kind IN ('SERVICE_REQUEST', 'ORDER', 'IDENTITY', 'CHECKOUT', 'MESSAGE')
  );

GRANT SELECT, INSERT, UPDATE (
  status, rejection_reason, reviewed_at, reviewed_by, purged_at, version
) ON guest_identity_documents TO app_rw;
GRANT SELECT, INSERT, UPDATE (read_at) ON guest_notifications TO app_rw;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['guest_identity_documents', 'guest_notifications'] LOOP
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
