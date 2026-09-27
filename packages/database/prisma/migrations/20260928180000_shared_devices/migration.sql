-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "device_id" UUID;

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "token_hash" TEXT,
    "pairing_code_hash" TEXT,
    "pairing_expires_at" TIMESTAMPTZ(3),
    "paired_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_pins" (
    "membership_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_pins_pkey" PRIMARY KEY ("membership_id")
);

-- CreateTable
CREATE TABLE "device_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_token_hash_key" ON "devices"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "devices_pairing_code_hash_key" ON "devices"("pairing_code_hash");

-- CreateIndex
CREATE INDEX "devices_organization_id_property_id_idx" ON "devices"("organization_id", "property_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_organization_id_id_key" ON "devices"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_pins_organization_id_membership_id_key" ON "staff_pins"("organization_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_sessions_token_hash_key" ON "device_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "device_sessions_organization_id_device_id_idx" ON "device_sessions"("organization_id", "device_id");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_id_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_pins" ADD CONSTRAINT "staff_pins_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_organization_id_device_id_fkey" FOREIGN KEY ("organization_id", "device_id") REFERENCES "devices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- =======================================================================================
-- Hand-written: integrity rules, privileges and row-level security
-- =======================================================================================

ALTER TABLE devices
  ADD CONSTRAINT devices_permissions CHECK (
    cardinality(permissions) > 0
    AND permissions <@ ARRAY['fnb.order.read', 'fnb.order.update', 'fnb.menu.availability']::text[]
  ),
  ADD CONSTRAINT devices_pairing CHECK ((pairing_code_hash IS NULL) = (pairing_expires_at IS NULL));
ALTER TABLE staff_pins
  ADD CONSTRAINT staff_pins_attempts CHECK (failed_attempts >= 0);
ALTER TABLE device_sessions
  ADD CONSTRAINT device_sessions_expiry CHECK (expires_at > created_at);

-- A device finds itself (pairing code or device token) before any tenant is known: the
-- hash in app.device_token_hash exposes exactly that device, read-only.
CREATE FUNCTION app.current_device_token() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.device_token_hash', true), '') $$;
GRANT EXECUTE ON FUNCTION app.current_device_token() TO app_rw;

GRANT SELECT, INSERT, UPDATE (
  name, token_hash, pairing_code_hash, pairing_expires_at, paired_at, last_seen_at, revoked_at
) ON devices TO app_rw;
GRANT SELECT, INSERT, UPDATE (pin_hash, failed_attempts, locked_until, updated_at), DELETE
  ON staff_pins TO app_rw;
GRANT SELECT, INSERT, UPDATE (last_seen_at, ended_at) ON device_sessions TO app_rw;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['devices', 'staff_pins', 'device_sessions'] LOOP
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

CREATE POLICY by_device_token ON devices FOR SELECT TO app_rw
  USING (
    token_hash = app.current_device_token()
    OR pairing_code_hash = app.current_device_token()
  );
