
-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT NOT NULL DEFAULT '',
    "guest_visible" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "organizer_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_participants" (
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,

    CONSTRAINT "event_participants_pkey" PRIMARY KEY ("event_id","membership_id")
);

-- CreateIndex
CREATE INDEX "events_organization_id_property_id_starts_at_idx" ON "events"("organization_id", "property_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "events_organization_id_id_key" ON "events"("organization_id", "id");

-- CreateIndex
CREATE INDEX "event_participants_organization_id_membership_id_idx" ON "event_participants"("organization_id", "membership_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_organization_id_event_id_fkey" FOREIGN KEY ("organization_id", "event_id") REFERENCES "events"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;



-- =======================================================================================
-- Hand-written (ADR-0026)
-- =======================================================================================

ALTER TABLE events
  ADD CONSTRAINT events_category CHECK (
    category IN ('HOTEL_EVENT', 'MEETING', 'TRAINING', 'CONFERENCE', 'MAINTENANCE',
                 'EMPLOYEE_ACTIVITY', 'GROUP_EVENT', 'GUEST_ACTIVITY')
  ),
  ADD CONSTRAINT events_status CHECK (status IN ('SCHEDULED', 'CANCELLED')),
  ADD CONSTRAINT events_period CHECK (ends_at > starts_at);

GRANT SELECT, INSERT, UPDATE (
  title, description, category, starts_at, ends_at, all_day, location, guest_visible, status,
  updated_at, version
) ON events TO app_rw;
GRANT SELECT, INSERT, DELETE ON event_participants TO app_rw;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['events', 'event_participants'] LOOP
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
