-- Needed by the room_assignments exclusion constraint (trusted extension).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "HousekeepingStatus" AS ENUM ('DIRTY', 'CLEANING', 'CLEAN', 'INSPECTED');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('IN_SERVICE', 'OUT_OF_SERVICE', 'OUT_OF_ORDER');

-- CreateEnum
CREATE TYPE "RoomStatusDimension" AS ENUM ('HOUSEKEEPING', 'SERVICE');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReservationRoomStatus" AS ENUM ('RESERVED', 'IN_HOUSE', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('DIRECT', 'WALK_IN', 'PHONE', 'WEBSITE', 'CORPORATE', 'TRAVEL_AGENT', 'OTA');

-- CreateEnum
CREATE TYPE "RoomAssignmentKind" AS ENUM ('RESERVATION', 'BLOCK');

-- CreateTable
CREATE TABLE "buildings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "base_occupancy" INTEGER NOT NULL,
    "max_occupancy" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "floor_id" UUID,
    "number" TEXT NOT NULL,
    "housekeeping_status" "HousekeepingStatus" NOT NULL DEFAULT 'INSPECTED',
    "service_status" "ServiceStatus" NOT NULL DEFAULT 'IN_SERVICE',
    "notes" TEXT NOT NULL DEFAULT '',
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_status_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "dimension" "RoomStatusDimension" NOT NULL,
    "from_value" TEXT NOT NULL,
    "to_value" TEXT NOT NULL,
    "reason" TEXT,
    "actor_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_nights" (
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "stay_date" DATE NOT NULL,
    "capacity" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "overbooking_limit" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_nights_pkey" PRIMARY KEY ("room_type_id","stay_date")
);

-- CreateTable
CREATE TABLE "rate_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "cancellation_policy" TEXT NOT NULL DEFAULT '',
    "currency" CHAR(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "rate_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_plan_room_types" (
    "organization_id" UUID NOT NULL,
    "rate_plan_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "base_amount_minor" BIGINT NOT NULL,

    CONSTRAINT "rate_plan_room_types_pkey" PRIMARY KEY ("rate_plan_id","room_type_id")
);

-- CreateTable
CREATE TABLE "rate_overrides" (
    "organization_id" UUID NOT NULL,
    "rate_plan_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "stay_date" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,

    CONSTRAINT "rate_overrides_pkey" PRIMARY KEY ("rate_plan_id","room_type_id","stay_date")
);

-- CreateTable
CREATE TABLE "guests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" CITEXT,
    "phone" TEXT,
    "country_code" CHAR(2),
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at_property_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "confirmation_no" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "booker_guest_id" UUID NOT NULL,
    "source" "BookingSource" NOT NULL,
    "external_ref" TEXT,
    "special_requests" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "currency" CHAR(3) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_rooms" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "rate_plan_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "arrival_date" DATE NOT NULL,
    "departure_date" DATE NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL DEFAULT 0,
    "status" "ReservationRoomStatus" NOT NULL DEFAULT 'RESERVED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reservation_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_nights" (
    "organization_id" UUID NOT NULL,
    "reservation_room_id" UUID NOT NULL,
    "stay_date" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,

    CONSTRAINT "reservation_nights_pkey" PRIMARY KEY ("reservation_room_id","stay_date")
);

-- CreateTable
CREATE TABLE "room_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "kind" "RoomAssignmentKind" NOT NULL,
    "reservation_room_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "room_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("property_id","name")
);

-- CreateIndex
CREATE UNIQUE INDEX "buildings_organization_id_id_key" ON "buildings"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_property_id_code_key" ON "buildings"("property_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "floors_organization_id_id_key" ON "floors"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "floors_building_id_level_key" ON "floors"("building_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "room_types_organization_id_id_key" ON "room_types"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "room_types_property_id_code_key" ON "room_types"("property_id", "code");

-- CreateIndex
CREATE INDEX "rooms_organization_id_room_type_id_idx" ON "rooms"("organization_id", "room_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_organization_id_id_key" ON "rooms"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_property_id_number_key" ON "rooms"("property_id", "number");

-- CreateIndex
CREATE INDEX "room_status_events_organization_id_room_id_occurred_at_idx" ON "room_status_events"("organization_id", "room_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_nights_organization_id_property_id_stay_date_idx" ON "inventory_nights"("organization_id", "property_id", "stay_date");

-- CreateIndex
CREATE UNIQUE INDEX "rate_plans_organization_id_id_key" ON "rate_plans"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "rate_plans_property_id_code_key" ON "rate_plans"("property_id", "code");

-- CreateIndex
CREATE INDEX "guests_organization_id_last_name_first_name_idx" ON "guests"("organization_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "guests_organization_id_email_idx" ON "guests"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "guests_organization_id_id_key" ON "guests"("organization_id", "id");

-- CreateIndex
CREATE INDEX "reservations_organization_id_property_id_created_at_idx" ON "reservations"("organization_id", "property_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_organization_id_id_key" ON "reservations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_property_id_confirmation_no_key" ON "reservations"("property_id", "confirmation_no");

-- CreateIndex
CREATE INDEX "reservation_rooms_organization_id_property_id_arrival_date_idx" ON "reservation_rooms"("organization_id", "property_id", "arrival_date");

-- CreateIndex
CREATE INDEX "reservation_rooms_organization_id_property_id_departure_dat_idx" ON "reservation_rooms"("organization_id", "property_id", "departure_date");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_rooms_organization_id_id_key" ON "reservation_rooms"("organization_id", "id");

-- CreateIndex
CREATE INDEX "room_assignments_organization_id_room_id_start_date_idx" ON "room_assignments"("organization_id", "room_id", "start_date");

-- CreateIndex
CREATE INDEX "room_assignments_organization_id_reservation_room_id_idx" ON "room_assignments"("organization_id", "reservation_room_id");

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floors" ADD CONSTRAINT "floors_organization_id_building_id_fkey" FOREIGN KEY ("organization_id", "building_id") REFERENCES "buildings"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organization_id_room_type_id_fkey" FOREIGN KEY ("organization_id", "room_type_id") REFERENCES "room_types"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organization_id_floor_id_fkey" FOREIGN KEY ("organization_id", "floor_id") REFERENCES "floors"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_status_events" ADD CONSTRAINT "room_status_events_organization_id_room_id_fkey" FOREIGN KEY ("organization_id", "room_id") REFERENCES "rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_nights" ADD CONSTRAINT "inventory_nights_organization_id_room_type_id_fkey" FOREIGN KEY ("organization_id", "room_type_id") REFERENCES "room_types"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plan_room_types" ADD CONSTRAINT "rate_plan_room_types_organization_id_rate_plan_id_fkey" FOREIGN KEY ("organization_id", "rate_plan_id") REFERENCES "rate_plans"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plan_room_types" ADD CONSTRAINT "rate_plan_room_types_organization_id_room_type_id_fkey" FOREIGN KEY ("organization_id", "room_type_id") REFERENCES "room_types"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_overrides" ADD CONSTRAINT "rate_overrides_organization_id_rate_plan_id_fkey" FOREIGN KEY ("organization_id", "rate_plan_id") REFERENCES "rate_plans"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_overrides" ADD CONSTRAINT "rate_overrides_organization_id_room_type_id_fkey" FOREIGN KEY ("organization_id", "room_type_id") REFERENCES "room_types"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_organization_id_booker_guest_id_fkey" FOREIGN KEY ("organization_id", "booker_guest_id") REFERENCES "guests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_organization_id_reservation_id_fkey" FOREIGN KEY ("organization_id", "reservation_id") REFERENCES "reservations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_organization_id_room_type_id_fkey" FOREIGN KEY ("organization_id", "room_type_id") REFERENCES "room_types"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_organization_id_rate_plan_id_fkey" FOREIGN KEY ("organization_id", "rate_plan_id") REFERENCES "rate_plans"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_organization_id_guest_id_fkey" FOREIGN KEY ("organization_id", "guest_id") REFERENCES "guests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_nights" ADD CONSTRAINT "reservation_nights_organization_id_reservation_room_id_fkey" FOREIGN KEY ("organization_id", "reservation_room_id") REFERENCES "reservation_rooms"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_organization_id_room_id_fkey" FOREIGN KEY ("organization_id", "room_id") REFERENCES "rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_organization_id_reservation_room_id_fkey" FOREIGN KEY ("organization_id", "reservation_room_id") REFERENCES "reservation_rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =======================================================================================
-- Hand-written: integrity rules, privileges and row-level security
-- =======================================================================================

-- ---- Integrity ------------------------------------------------------------------------
ALTER TABLE room_types
  ADD CONSTRAINT room_types_occupancy CHECK (base_occupancy >= 1 AND max_occupancy >= base_occupancy AND max_occupancy <= 20);

ALTER TABLE rooms
  ADD CONSTRAINT rooms_number_format CHECK (number ~ '^[A-Za-z0-9-]{1,10}$');

ALTER TABLE inventory_nights
  ADD CONSTRAINT inventory_nights_non_negative CHECK (capacity >= 0 AND sold >= 0 AND blocked >= 0 AND overbooking_limit >= 0),
  -- The core overselling guard (blueprint §12.3).
  ADD CONSTRAINT inventory_nights_not_oversold CHECK (sold + blocked <= capacity + overbooking_limit);

ALTER TABLE rate_plan_room_types
  ADD CONSTRAINT rate_plan_room_types_amount CHECK (base_amount_minor >= 0);
ALTER TABLE rate_overrides
  ADD CONSTRAINT rate_overrides_amount CHECK (amount_minor >= 0);
ALTER TABLE rate_plans
  ADD CONSTRAINT rate_plans_currency_iso CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE guests
  ADD CONSTRAINT guests_name_present CHECK (length(trim(first_name)) > 0 AND length(trim(last_name)) > 0);

ALTER TABLE reservation_rooms
  ADD CONSTRAINT reservation_rooms_dates CHECK (departure_date > arrival_date AND departure_date - arrival_date <= 365),
  ADD CONSTRAINT reservation_rooms_occupants CHECK (adults >= 1 AND children >= 0);

ALTER TABLE reservation_nights
  ADD CONSTRAINT reservation_nights_amount CHECK (amount_minor >= 0);

ALTER TABLE room_assignments
  ADD CONSTRAINT room_assignments_dates CHECK (end_date > start_date),
  ADD CONSTRAINT room_assignments_kind_target CHECK (
    (kind = 'RESERVATION' AND reservation_room_id IS NOT NULL)
    OR (kind = 'BLOCK' AND reservation_room_id IS NULL)
  ),
  -- A room can never be held twice for overlapping nights, whoever writes the rows
  -- (blueprint §7.4). Released holds keep their history but stop counting.
  ADD CONSTRAINT room_assignments_no_overlap EXCLUDE USING gist (
    room_id WITH =,
    daterange(start_date, end_date, '[)') WITH &&
  ) WHERE (released_at IS NULL);

-- At most one active room per reservation room.
CREATE UNIQUE INDEX room_assignments_one_active_per_reservation_room
  ON room_assignments (reservation_room_id)
  WHERE released_at IS NULL AND kind = 'RESERVATION';

-- Guest search (name / email prefix and fuzzy).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX guests_search_trgm ON guests
  USING gin ((lower(first_name || ' ' || last_name || ' ' || coalesce(email::text, ''))) gin_trgm_ops);

-- History of room status is append-only.
CREATE TRIGGER room_status_events_append_only
  BEFORE UPDATE OR DELETE ON room_status_events
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- ---- Privileges -----------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON
  buildings, floors, room_types, rooms, rate_plans, inventory_nights,
  guests, reservations, reservation_rooms, number_sequences
TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_plan_room_types, rate_overrides, reservation_nights TO app_rw;
GRANT SELECT, INSERT, UPDATE (released_at, end_date) ON room_assignments TO app_rw;
GRANT SELECT, INSERT ON room_status_events TO app_rw;

-- ---- Row-level security ---------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'buildings', 'floors', 'room_types', 'rooms', 'room_status_events', 'inventory_nights',
    'rate_plans', 'rate_plan_room_types', 'rate_overrides', 'guests', 'reservations',
    'reservation_rooms', 'reservation_nights', 'room_assignments', 'number_sequences'
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

-- ---- Role-template propagation (system job, see catalog.ts) ---------------------------
-- When a release adds permissions to a system template, the catalog sync adds them to the
-- organization roles still linked to that template. It runs as app_system, which may only
-- read the columns it needs, insert role permissions, and bump grants versions.
GRANT SELECT (id, organization_id, template_key) ON roles TO app_system;
CREATE POLICY template_sync ON roles FOR SELECT TO app_system USING (template_key IS NOT NULL);

GRANT SELECT, INSERT ON role_permissions TO app_system;
CREATE POLICY template_sync_read ON role_permissions FOR SELECT TO app_system USING (true);
CREATE POLICY template_sync_insert ON role_permissions FOR INSERT TO app_system WITH CHECK (true);

GRANT SELECT (membership_id, role_id) ON role_assignments TO app_system;
CREATE POLICY template_sync ON role_assignments FOR SELECT TO app_system USING (true);

GRANT SELECT (id, grants_version), UPDATE (grants_version) ON organization_memberships TO app_system;
CREATE POLICY template_sync_read ON organization_memberships FOR SELECT TO app_system USING (true);
CREATE POLICY template_sync_update ON organization_memberships FOR UPDATE TO app_system USING (true) WITH CHECK (true);
