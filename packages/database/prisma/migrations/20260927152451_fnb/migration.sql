-- CreateEnum
CREATE TYPE "OutletType" AS ENUM ('RESTAURANT', 'BAR', 'CAFE', 'ROOM_SERVICE');

-- CreateEnum
CREATE TYPE "ChargeMethod" AS ENUM ('ROOM_CHARGE', 'PAY_ON_DELIVERY', 'PAY_AT_OUTLET');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('GUEST', 'STAFF');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "outlets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OutletType" NOT NULL,
    "room_service" BOOLEAN NOT NULL DEFAULT false,
    "allow_room_charge" BOOLEAN NOT NULL DEFAULT true,
    "opens_at" VARCHAR(5),
    "closes_at" VARCHAR(5),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price_minor" BIGINT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_groups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifiers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_minor" BIGINT NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "order_no" TEXT NOT NULL,
    "source" "OrderSource" NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "charge_method" "ChargeMethod" NOT NULL,
    "room_id" UUID,
    "reservation_room_id" UUID,
    "guest_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "subtotal_minor" BIGINT NOT NULL,
    "added_tax_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "tax_rules" JSONB NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "folio_id" UUID,
    "folio_line_id" UUID,
    "charged_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "modifiers" JSONB NOT NULL,
    "line_total_minor" BIGINT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "note" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outlets_organization_id_id_key" ON "outlets"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "outlets_property_id_code_key" ON "outlets"("property_id", "code");

-- CreateIndex
CREATE INDEX "menu_categories_organization_id_outlet_id_idx" ON "menu_categories"("organization_id", "outlet_id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_organization_id_id_key" ON "menu_categories"("organization_id", "id");

-- CreateIndex
CREATE INDEX "menu_items_organization_id_outlet_id_idx" ON "menu_items"("organization_id", "outlet_id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_organization_id_id_key" ON "menu_items"("organization_id", "id");

-- CreateIndex
CREATE INDEX "modifier_groups_organization_id_menu_item_id_idx" ON "modifier_groups"("organization_id", "menu_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_groups_organization_id_id_key" ON "modifier_groups"("organization_id", "id");

-- CreateIndex
CREATE INDEX "modifiers_organization_id_group_id_idx" ON "modifiers"("organization_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "modifiers_organization_id_id_key" ON "modifiers"("organization_id", "id");

-- CreateIndex
CREATE INDEX "orders_organization_id_property_id_status_idx" ON "orders"("organization_id", "property_id", "status");

-- CreateIndex
CREATE INDEX "orders_organization_id_outlet_id_status_idx" ON "orders"("organization_id", "outlet_id", "status");

-- CreateIndex
CREATE INDEX "orders_organization_id_reservation_room_id_idx" ON "orders"("organization_id", "reservation_room_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_organization_id_id_key" ON "orders"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_property_id_order_no_key" ON "orders"("property_id", "order_no");

-- CreateIndex
CREATE INDEX "order_items_organization_id_order_id_idx" ON "order_items"("organization_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_organization_id_id_key" ON "order_items"("organization_id", "id");

-- CreateIndex
CREATE INDEX "order_events_organization_id_order_id_idx" ON "order_events"("organization_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_events_organization_id_id_key" ON "order_events"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_organization_id_outlet_id_fkey" FOREIGN KEY ("organization_id", "outlet_id") REFERENCES "outlets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_organization_id_outlet_id_fkey" FOREIGN KEY ("organization_id", "outlet_id") REFERENCES "outlets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "menu_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_organization_id_menu_item_id_fkey" FOREIGN KEY ("organization_id", "menu_item_id") REFERENCES "menu_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_organization_id_group_id_fkey" FOREIGN KEY ("organization_id", "group_id") REFERENCES "modifier_groups"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_outlet_id_fkey" FOREIGN KEY ("organization_id", "outlet_id") REFERENCES "outlets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_room_id_fkey" FOREIGN KEY ("organization_id", "room_id") REFERENCES "rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_guest_id_fkey" FOREIGN KEY ("organization_id", "guest_id") REFERENCES "guests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_order_id_fkey" FOREIGN KEY ("organization_id", "order_id") REFERENCES "orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_menu_item_id_fkey" FOREIGN KEY ("organization_id", "menu_item_id") REFERENCES "menu_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_organization_id_order_id_fkey" FOREIGN KEY ("organization_id", "order_id") REFERENCES "orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =======================================================================================
-- Hand-written: integrity rules, append-only events, privileges and row-level security
-- =======================================================================================

-- ---- Integrity ------------------------------------------------------------------------
ALTER TABLE outlets
  ADD CONSTRAINT outlets_hours CHECK (
    (opens_at IS NULL) = (closes_at IS NULL)
    AND (opens_at IS NULL OR (opens_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                              AND closes_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
  );
ALTER TABLE menu_items ADD CONSTRAINT menu_items_price CHECK (price_minor >= 0);
ALTER TABLE modifiers ADD CONSTRAINT modifiers_price CHECK (price_minor >= 0);
ALTER TABLE modifier_groups
  ADD CONSTRAINT modifier_groups_selection CHECK (min_select >= 0 AND max_select >= 1 AND min_select <= max_select);
ALTER TABLE order_items
  ADD CONSTRAINT order_items_amounts CHECK (
    quantity > 0 AND unit_price_minor >= 0 AND line_total_minor >= 0
  );
ALTER TABLE orders
  ADD CONSTRAINT orders_amounts CHECK (
    subtotal_minor >= 0 AND added_tax_minor >= 0 AND total_minor = subtotal_minor + added_tax_minor
  ),
  ADD CONSTRAINT orders_currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
  -- A room charge always knows whose stay it goes to.
  ADD CONSTRAINT orders_room_charge_target CHECK (
    charge_method <> 'ROOM_CHARGE' OR (room_id IS NOT NULL AND reservation_room_id IS NOT NULL)
  ),
  ADD CONSTRAINT orders_charged_consistent CHECK (
    (folio_line_id IS NULL) = (charged_at IS NULL)
  );
-- One folio charge per order (the folio also refuses a second line with the same source key).
CREATE UNIQUE INDEX orders_one_folio_line ON orders (folio_line_id) WHERE folio_line_id IS NOT NULL;

CREATE TRIGGER order_events_append_only
  BEFORE UPDATE OR DELETE ON order_events
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- ---- Privileges -----------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON outlets, menu_categories, menu_items, modifier_groups, modifiers TO app_rw;
GRANT SELECT, INSERT, UPDATE (
  status, folio_id, folio_line_id, charged_at, cancel_reason, cancelled_at, updated_at, version
) ON orders TO app_rw;
GRANT SELECT, INSERT ON order_items, order_events TO app_rw;

-- ---- Row-level security ---------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'outlets', 'menu_categories', 'menu_items', 'modifier_groups', 'modifiers', 'orders',
    'order_items', 'order_events'
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
