-- Tenant isolation, privileges and integrity rules Prisma cannot express (ADR-0003).
--
-- Roles (created by infrastructure, not by migrations):
--   app_rw     runtime role for tenant work. RLS applies. Never owns objects.
--   app_system cross-tenant system jobs (outbox relay, schedulers). Only sees rows through
--              explicit policies granted to it; it does NOT have BYPASSRLS.
--
-- Every table with an organization_id column MUST have RLS enabled + forced and a
-- tenant_isolation policy. The integration suite fails if one is missing.

-- ---------------------------------------------------------------------------------------
-- Request context functions
-- ---------------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

-- NULLIF: a SET LOCAL value reverts to '' (not NULL) on a pooled connection after commit.
-- Unset context therefore yields NULL, and `organization_id = NULL` matches no rows.
CREATE FUNCTION app.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;

CREATE FUNCTION app.current_identity_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.identity_id', true), '')::uuid $$;

CREATE FUNCTION app.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_rw, app_system;
GRANT EXECUTE ON FUNCTION app.current_org_id(), app.current_identity_id() TO app_rw, app_system;

GRANT USAGE ON SCHEMA public TO app_rw, app_system;

-- ---------------------------------------------------------------------------------------
-- Privileges: platform tables (no tenant, no RLS)
-- ---------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON identities, identity_credentials, sessions TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_factors TO app_rw;
GRANT SELECT ON permissions, role_templates, feature_flag_definitions TO app_rw;

-- ---------------------------------------------------------------------------------------
-- Privileges: tenant tables
-- No DELETE where history matters: organizations, properties and memberships change
-- status instead of disappearing.
-- ---------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON organizations, properties, organization_memberships TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  brands,
  organization_settings,
  property_settings,
  organization_feature_flags,
  roles,
  role_permissions,
  role_assignments,
  idempotency_keys
TO app_rw;

-- Append-only for the runtime role.
GRANT SELECT, INSERT ON audit_logs, outbox_events TO app_rw;

-- Outbox relay.
GRANT SELECT, UPDATE (published_at, attempts, last_error) ON outbox_events TO app_system;

-- ---------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations TO app_rw
  USING (id = app.current_org_id())
  WITH CHECK (id = app.current_org_id());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brands',
    'properties',
    'organization_settings',
    'property_settings',
    'organization_feature_flags',
    'organization_memberships',
    'roles',
    'role_permissions',
    'role_assignments',
    'audit_logs',
    'outbox_events',
    'idempotency_keys'
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

-- Before an organization is chosen (login, org picker), a signed-in identity may list its
-- own memberships and the names of those organizations. Read-only.
CREATE POLICY identity_own_memberships ON organization_memberships FOR SELECT TO app_rw
  USING (identity_id = app.current_identity_id());

CREATE POLICY identity_member_organizations ON organizations FOR SELECT TO app_rw
  USING (
    EXISTS (
      SELECT 1
      FROM organization_memberships m
      WHERE m.organization_id = organizations.id
        AND m.identity_id = app.current_identity_id()
        AND m.status = 'ACTIVE'
    )
  );

-- The relay reads and marks events across tenants; it never sees any other table.
CREATE POLICY outbox_relay ON outbox_events TO app_system
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------------------
-- Integrity constraints
-- ---------------------------------------------------------------------------------------
ALTER TABLE organizations
  ADD CONSTRAINT organizations_default_currency_iso CHECK (default_currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$');

ALTER TABLE properties
  ADD CONSTRAINT properties_currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT properties_country_iso CHECK (country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT properties_check_in_time_hhmm CHECK (check_in_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT properties_check_out_time_hhmm CHECK (check_out_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT properties_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,15}$');

ALTER TABLE role_assignments
  ADD CONSTRAINT role_assignments_scope_matches_target CHECK (
    (scope_type = 'ORGANIZATION' AND property_id IS NULL)
    OR (scope_type = 'PROPERTY' AND property_id IS NOT NULL)
  );

-- Partial indexes (not NULLS NOT DISTINCT): Prisma ignores partial indexes when diffing,
-- so these survive future `prisma migrate dev` runs.
CREATE UNIQUE INDEX role_assignments_unique_org_grant
  ON role_assignments (membership_id, role_id) WHERE scope_type = 'ORGANIZATION';
CREATE UNIQUE INDEX role_assignments_unique_property_grant
  ON role_assignments (membership_id, role_id, property_id) WHERE scope_type = 'PROPERTY';

-- Relay scan: only unpublished rows, oldest first.
CREATE INDEX outbox_events_unpublished
  ON outbox_events (occurred_at) WHERE published_at IS NULL;

-- Defense in depth: even the owner cannot rewrite history through normal DML.
-- Retention jobs remove whole partitions / use a dedicated procedure (future ADR).
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
