
-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID,
    "membership_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_log" (
    "organization_id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_log_pkey" PRIMARY KEY ("organization_id","dedupe_key")
);

-- CreateIndex
CREATE INDEX "notifications_organization_id_membership_id_created_at_idx" ON "notifications"("organization_id", "membership_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;



-- =======================================================================================
-- Hand-written (ADR-0024)
-- =======================================================================================

ALTER TABLE notifications
  ADD CONSTRAINT notifications_link CHECK (link IS NULL OR link LIKE '/%');
ALTER TABLE message_log
  ADD CONSTRAINT message_log_channel CHECK (channel IN ('EMAIL', 'SMS', 'IN_APP'));

GRANT SELECT, INSERT, UPDATE (read_at) ON notifications TO app_rw;
GRANT SELECT, INSERT ON message_log TO app_rw;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notifications', 'message_log'] LOOP
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
