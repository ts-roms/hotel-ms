
-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "request_no" TEXT NOT NULL,
    "room_id" UUID,
    "location" TEXT,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "reported_by" UUID,
    "assigned_membership_id" UUID,
    "service_request_id" UUID,
    "block_id" UUID,
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_updates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "note" TEXT,
    "actor_id" UUID,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_photos" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_found_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "item_no" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "found_at" TIMESTAMPTZ(3) NOT NULL,
    "found_location" TEXT NOT NULL,
    "room_id" UUID,
    "storage_location" TEXT NOT NULL,
    "found_by" UUID,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "closing_note" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "lost_found_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_requests_organization_id_property_id_status_idx" ON "maintenance_requests"("organization_id", "property_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_requests_organization_id_room_id_idx" ON "maintenance_requests"("organization_id", "room_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_requests_organization_id_id_key" ON "maintenance_requests"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_requests_property_id_request_no_key" ON "maintenance_requests"("property_id", "request_no");

-- CreateIndex
CREATE INDEX "maintenance_updates_organization_id_request_id_at_idx" ON "maintenance_updates"("organization_id", "request_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_photos_storage_key_key" ON "maintenance_photos"("storage_key");

-- CreateIndex
CREATE INDEX "maintenance_photos_organization_id_request_id_idx" ON "maintenance_photos"("organization_id", "request_id");

-- CreateIndex
CREATE INDEX "lost_found_items_organization_id_property_id_status_idx" ON "lost_found_items"("organization_id", "property_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lost_found_items_organization_id_id_key" ON "lost_found_items"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lost_found_items_property_id_item_no_key" ON "lost_found_items"("property_id", "item_no");

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_organization_id_room_id_fkey" FOREIGN KEY ("organization_id", "room_id") REFERENCES "rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_organization_id_assigned_membership_i_fkey" FOREIGN KEY ("organization_id", "assigned_membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_organization_id_service_request_id_fkey" FOREIGN KEY ("organization_id", "service_request_id") REFERENCES "service_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "room_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_updates" ADD CONSTRAINT "maintenance_updates_organization_id_request_id_fkey" FOREIGN KEY ("organization_id", "request_id") REFERENCES "maintenance_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_photos" ADD CONSTRAINT "maintenance_photos_organization_id_request_id_fkey" FOREIGN KEY ("organization_id", "request_id") REFERENCES "maintenance_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_found_items" ADD CONSTRAINT "lost_found_items_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_found_items" ADD CONSTRAINT "lost_found_items_organization_id_room_id_fkey" FOREIGN KEY ("organization_id", "room_id") REFERENCES "rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- =======================================================================================
-- Hand-written (ADR-0023)
-- =======================================================================================

ALTER TABLE maintenance_requests
  ADD CONSTRAINT maintenance_requests_category CHECK (
    category IN ('ELECTRICAL', 'PLUMBING', 'HVAC', 'FURNITURE', 'APPLIANCE', 'IT', 'STRUCTURAL', 'OTHER')
  ),
  ADD CONSTRAINT maintenance_requests_priority CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  ADD CONSTRAINT maintenance_requests_status CHECK (
    status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'DONE', 'CANCELLED')
  ),
  ADD CONSTRAINT maintenance_requests_place CHECK (room_id IS NOT NULL OR location IS NOT NULL),
  ADD CONSTRAINT maintenance_requests_block CHECK (block_id IS NULL OR room_id IS NOT NULL),
  ADD CONSTRAINT maintenance_requests_closed CHECK (
    (status IN ('DONE', 'CANCELLED')) = (completed_at IS NOT NULL)
  ),
  ADD CONSTRAINT maintenance_requests_resolution CHECK (status <> 'DONE' OR resolution IS NOT NULL),
  ADD CONSTRAINT maintenance_requests_assigned CHECK (
    status IN ('OPEN', 'CANCELLED') OR assigned_membership_id IS NOT NULL
  );

ALTER TABLE maintenance_updates
  ADD CONSTRAINT maintenance_updates_kind CHECK (
    kind IN ('CREATED', 'ASSIGNED', 'STATUS', 'NOTE', 'PHOTO')
  );
CREATE TRIGGER maintenance_updates_append_only
  BEFORE UPDATE OR DELETE ON maintenance_updates
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

ALTER TABLE maintenance_photos
  ADD CONSTRAINT maintenance_photos_type CHECK (
    content_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  ADD CONSTRAINT maintenance_photos_size CHECK (size_bytes BETWEEN 1 AND 8388608),
  ADD CONSTRAINT maintenance_photos_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE lost_found_items
  ADD CONSTRAINT lost_found_items_category CHECK (
    category IN ('VALUABLES', 'DOCUMENTS', 'ELECTRONICS', 'CLOTHING', 'OTHER')
  ),
  ADD CONSTRAINT lost_found_items_status CHECK (status IN ('HELD', 'RETURNED', 'DISPOSED')),
  ADD CONSTRAINT lost_found_items_closed CHECK (
    (status = 'HELD') = (closed_at IS NULL)
    AND (status = 'HELD') = (closing_note IS NULL)
  );

GRANT SELECT, INSERT, UPDATE (
  priority, status, assigned_membership_id, resolution, started_at, completed_at, updated_at, version
) ON maintenance_requests TO app_rw;
GRANT SELECT, INSERT ON maintenance_updates, maintenance_photos TO app_rw;
GRANT SELECT, INSERT, UPDATE (status, closing_note, closed_at, closed_by, version)
  ON lost_found_items TO app_rw;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['maintenance_requests', 'maintenance_updates', 'maintenance_photos', 'lost_found_items'] LOOP
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
