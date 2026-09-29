-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "image_key" TEXT,
ADD COLUMN     "image_sha256" CHAR(64);

-- CreateTable
CREATE TABLE "property_images" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "property_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_images_organization_id_property_id_sort_order_idx" ON "property_images"("organization_id", "property_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "property_images_organization_id_id_key" ON "property_images"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =======================================================================================
-- Hand-written (ADR-0030)
-- =======================================================================================

ALTER TABLE property_images
  ADD CONSTRAINT property_images_size CHECK (size_bytes > 0 AND width > 0 AND height > 0);

ALTER TABLE menu_items
  ADD CONSTRAINT menu_items_image CHECK ((image_key IS NULL) = (image_sha256 IS NULL));

GRANT SELECT, INSERT, UPDATE (caption, sort_order), DELETE ON property_images TO app_rw;

ALTER TABLE property_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_images FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON property_images TO app_rw
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());
