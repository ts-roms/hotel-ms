-- Local-only bootstrap. In cloud environments the db-bootstrap task creates these roles
-- (packages/database/src/bootstrap, run on deploy with credentials from Secrets Manager).
--
-- hotel_owner  : owns schema objects, runs migrations. Never used by the running app.
-- hotel_app    : runtime role for API + worker tenant work. Member of app_rw. RLS enforced.
-- hotel_system : narrowly-used role for cross-tenant system jobs (outbox relay, schedulers).
--                Member of app_system, which has explicit permissive policies (no BYPASSRLS).
CREATE ROLE app_rw NOLOGIN;
CREATE ROLE app_system NOLOGIN;

CREATE ROLE hotel_owner LOGIN PASSWORD 'hotel_owner' CREATEDB;
CREATE ROLE hotel_app LOGIN PASSWORD 'hotel_app' IN ROLE app_rw;
CREATE ROLE hotel_system LOGIN PASSWORD 'hotel_system' IN ROLE app_system;

CREATE DATABASE hotel OWNER hotel_owner;
CREATE DATABASE hotel_test OWNER hotel_owner;
