-- CreateEnum
CREATE TYPE "ServiceRequestSource" AS ENUM ('GUEST', 'STAFF');

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceRequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "reservation_rooms" ADD COLUMN     "expected_arrival_time" VARCHAR(5),
ADD COLUMN     "pre_check_in_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "guest_portal_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "guest_portal_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "reservation_room_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "guest_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "request_no" TEXT NOT NULL,
    "source" "ServiceRequestSource" NOT NULL,
    "category" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "priority" "ServiceRequestPriority" NOT NULL DEFAULT 'NORMAL',
    "description" TEXT NOT NULL DEFAULT '',
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'OPEN',
    "reservation_room_id" UUID,
    "room_id" UUID,
    "guest_id" UUID,
    "assigned_membership_id" UUID,
    "rating" INTEGER,
    "feedback" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guest_portal_links_token_hash_key" ON "guest_portal_links"("token_hash");

-- CreateIndex
CREATE INDEX "guest_portal_links_organization_id_reservation_id_idx" ON "guest_portal_links"("organization_id", "reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "guest_portal_links_organization_id_id_key" ON "guest_portal_links"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "guest_sessions_token_hash_key" ON "guest_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "guest_sessions_organization_id_reservation_id_idx" ON "guest_sessions"("organization_id", "reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "guest_sessions_organization_id_id_key" ON "guest_sessions"("organization_id", "id");

-- CreateIndex
CREATE INDEX "service_requests_organization_id_property_id_status_idx" ON "service_requests"("organization_id", "property_id", "status");

-- CreateIndex
CREATE INDEX "service_requests_organization_id_reservation_room_id_idx" ON "service_requests"("organization_id", "reservation_room_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_organization_id_id_key" ON "service_requests"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_property_id_request_no_key" ON "service_requests"("property_id", "request_no");

-- AddForeignKey
ALTER TABLE "guest_portal_links" ADD CONSTRAINT "guest_portal_links_organization_id_reservation_id_fkey" FOREIGN KEY ("organization_id", "reservation_id") REFERENCES "reservations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_organization_id_reservation_id_fkey" FOREIGN KEY ("organization_id", "reservation_id") REFERENCES "reservations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_organization_id_room_id_fkey" FOREIGN KEY ("organization_id", "room_id") REFERENCES "rooms"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_organization_id_guest_id_fkey" FOREIGN KEY ("organization_id", "guest_id") REFERENCES "guests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_organization_id_assigned_membership_id_fkey" FOREIGN KEY ("organization_id", "assigned_membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =======================================================================================
-- Hand-written: token lookup policies, integrity, privileges, row-level security
-- =======================================================================================

CREATE FUNCTION app.current_guest_link_hash() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.guest_link_hash', true), '') $$;
CREATE FUNCTION app.current_guest_session_hash() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.guest_session_hash', true), '') $$;
GRANT EXECUTE ON FUNCTION app.current_guest_link_hash(), app.current_guest_session_hash() TO app_rw;

ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
ALTER TABLE reservation_rooms
  ADD CONSTRAINT reservation_rooms_expected_arrival_time
  CHECK (expected_arrival_time IS NULL OR expected_arrival_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

GRANT SELECT, INSERT, UPDATE (revoked_at) ON guest_portal_links TO app_rw;
GRANT SELECT, INSERT, UPDATE (verified_at, last_seen_at, revoked_at) ON guest_sessions TO app_rw;
GRANT SELECT, INSERT, UPDATE ON service_requests TO app_rw;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['guest_portal_links', 'guest_sessions', 'service_requests'] LOOP
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

-- A signed-out visitor presenting a link token / guest session cookie can read exactly the
-- matching row (and learn its organization); everything after runs in tenant context.
CREATE POLICY by_link_token ON guest_portal_links FOR SELECT TO app_rw
  USING (token_hash = app.current_guest_link_hash());
CREATE POLICY by_session_token ON guest_sessions FOR SELECT TO app_rw
  USING (token_hash = app.current_guest_session_hash());
