-- Platform operators and the ops dashboard (ADR-0029).

ALTER TABLE "identities" ADD COLUMN "platform_role" TEXT;

ALTER TABLE identities
  ADD CONSTRAINT identities_platform_role CHECK (platform_role IN ('OPERATOR'));

-- The runtime role keeps updating identities (logins, lockouts, profile) but can never
-- make anyone an operator: that column is written by the owner role only.
REVOKE UPDATE ON identities FROM app_rw;
GRANT UPDATE (email, display_name, status, failed_login_count, locked_until, last_login_at,
              updated_at)
  ON identities TO app_rw;

-- The worker builds the ops snapshot as app_system: payment webhook processing state (a
-- platform table; no payloads). It still sees no tenant business data, not even names.
GRANT SELECT (id, provider, event_type, status, attempts, last_error, received_at, processed_at)
  ON webhook_events TO app_system;
