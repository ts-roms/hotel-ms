
-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'KITCHEN';

-- CreateTable
CREATE TABLE "attendance_photos" (
    "punch_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" UUID,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "attendance_photos_pkey" PRIMARY KEY ("punch_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_photos_storage_key_key" ON "attendance_photos"("storage_key");

-- CreateIndex
CREATE INDEX "attendance_photos_organization_id_created_at_idx" ON "attendance_photos"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_photos_organization_id_punch_id_key" ON "attendance_photos"("organization_id", "punch_id");

-- AddForeignKey
ALTER TABLE "attendance_photos" ADD CONSTRAINT "attendance_photos_organization_id_punch_id_fkey" FOREIGN KEY ("organization_id", "punch_id") REFERENCES "attendance_punches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_photos" ADD CONSTRAINT "attendance_photos_organization_id_device_id_fkey" FOREIGN KEY ("organization_id", "device_id") REFERENCES "devices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- =======================================================================================
-- Hand-written (ADR-0022)
-- =======================================================================================

-- Time clocks carry no permissions: nobody signs in on them.
ALTER TABLE devices DROP CONSTRAINT devices_permissions;
ALTER TABLE devices
  ADD CONSTRAINT devices_kind CHECK (kind IN ('KITCHEN', 'TIME_CLOCK')),
  ADD CONSTRAINT devices_permissions CHECK (
    (kind = 'KITCHEN'
      AND cardinality(permissions) > 0
      AND permissions <@ ARRAY['fnb.order.read', 'fnb.order.update', 'fnb.menu.availability']::text[])
    OR (kind = 'TIME_CLOCK' AND cardinality(permissions) = 0)
  );

ALTER TABLE attendance_photos
  ADD CONSTRAINT attendance_photos_type CHECK (
    content_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  ADD CONSTRAINT attendance_photos_size CHECK (size_bytes BETWEEN 1 AND 2097152),
  ADD CONSTRAINT attendance_photos_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$');

GRANT SELECT, INSERT, UPDATE (deleted_at) ON attendance_photos TO app_rw;

ALTER TABLE attendance_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_photos TO app_rw
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());
