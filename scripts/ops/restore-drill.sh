#!/usr/bin/env bash
# Restore drill (ADR-0029, docs/operations/restore.md): back up a database, restore it into
# a scratch database on the same server, and check that the copy is usable: every migration
# applied, tenant isolation intact, runtime privileges intact, and the same rows.
#
# Usage (from the repository root):
#   ADMIN_URL=postgresql://postgres:...@localhost:5432/postgres scripts/ops/restore-drill.sh
#
# Environment:
#   ADMIN_URL     URL of a role that bypasses row-level security (a superuser, or a backup
#                 role WITH BYPASSRLS). Required: RLS is forced on tenant tables, so even
#                 the owner role cannot read them all, and a dump would fail.
#   SOURCE_DB     database to back up (default hotel)
#   TARGET_DB     scratch database (default hotel_restore_drill); dropped and recreated
#   KEEP_RESTORE  set to 1 to keep the scratch database for inspection
#
# Requires pg_dump, pg_restore and psql at least as new as the server.
set -euo pipefail

ADMIN_URL="${ADMIN_URL:?ADMIN_URL (a role that bypasses row-level security) is required}"
SOURCE_DB="${SOURCE_DB:-hotel}"
TARGET_DB="${TARGET_DB:-hotel_restore_drill}"
MIGRATIONS_DIR="packages/database/prisma/migrations"
# Only warnings and errors from psql (no NOTICE for DROP ... IF EXISTS).
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

for db in "$SOURCE_DB" "$TARGET_DB"; do
  if [[ ! "$db" =~ ^[a-z_][a-z0-9_]*$ ]]; then
    echo "Database names must be plain lowercase identifiers: $db" >&2
    exit 2
  fi
done
if [[ "$SOURCE_DB" == "$TARGET_DB" ]]; then
  echo "TARGET_DB must differ from SOURCE_DB" >&2
  exit 2
fi

# Same server and credentials, another database: swap the path, keep any query string.
with_db() {
  local url="$1" db="$2" query=""
  if [[ "$url" == *\?* ]]; then
    query="?${url#*\?}"
    url="${url%%\?*}"
  fi
  echo "${url%/*}/$db$query"
}
SOURCE_URL="$(with_db "$ADMIN_URL" "$SOURCE_DB")"
TARGET_URL="$(with_db "$ADMIN_URL" "$TARGET_DB")"
workdir="$(mktemp -d)"
dump="$workdir/backup.dump"

cleanup() {
  rm -rf "$workdir"
  if [[ "${KEEP_RESTORE:-0}" != "1" ]]; then
    psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $TARGET_DB WITH (FORCE)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

fail() {
  echo "RESTORE DRILL FAILED: $*" >&2
  exit 1
}

started=$(date +%s)
echo "1/5 Backing up $SOURCE_DB"
pg_dump --format=custom --file "$dump" "$SOURCE_URL"
echo "    $(du -h "$dump" | cut -f1) in $(($(date +%s) - started)) s"

echo "2/5 Restoring into $TARGET_DB"
owner=$(psql "$ADMIN_URL" -tAc \
  "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$SOURCE_DB'")
[[ -n "$owner" ]] || fail "database $SOURCE_DB not found"
psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $TARGET_DB WITH (FORCE)"
psql "$ADMIN_URL" -qc "CREATE DATABASE $TARGET_DB OWNER \"$owner\""
pg_restore --exit-on-error --dbname "$TARGET_URL" "$dump"
echo "    restored in $(($(date +%s) - started)) s from the start of the backup"

echo "3/5 Migrations"
expected=$(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
applied=$(psql "$TARGET_URL" -tAc \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
[[ "$applied" == "$expected" ]] || fail "$applied migrations applied, $expected in the repository"
echo "    $applied of $expected applied"

echo "4/5 Tenant isolation and privileges"
unprotected=$(psql "$TARGET_URL" -tAc "
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity
              AND EXISTS (SELECT 1 FROM pg_policies p
                           WHERE p.schemaname = 'public' AND p.tablename = c.relname))")
[[ -z "$unprotected" ]] || fail "tables without forced row-level security: $unprotected"
privileges=$(psql "$TARGET_URL" -tAc "
  SELECT has_table_privilege('app_rw', 'reservations', 'SELECT')
     AND has_table_privilege('app_rw', 'outbox_events', 'INSERT')
     AND NOT has_table_privilege('app_rw', 'audit_logs', 'DELETE')
     AND NOT has_column_privilege('app_rw', 'identities', 'platform_role', 'UPDATE')
     AND has_table_privilege('app_system', 'outbox_events', 'SELECT')")
[[ "$privileges" == "t" ]] || fail "runtime role privileges differ from the migrations"
target_owner=$(psql "$ADMIN_URL" -tAc \
  "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$TARGET_DB'")
[[ "$target_owner" == "$owner" ]] || fail "restored database is owned by $target_owner, not $owner"
echo "    row-level security forced on every tenant table; runtime privileges intact"

echo "5/5 Row counts"
count_rows() {
  psql "$1" -tA -F ' ' -c "SET row_security = off" -c "
    SELECT table_name,
           (xpath('/row/c/text()',
                  query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name),
                               false, true, '')))[1]::text
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name"
}
count_rows "$SOURCE_URL" | grep -v '^SET$' >"$workdir/source.counts"
count_rows "$TARGET_URL" | grep -v '^SET$' >"$workdir/target.counts"
if ! diff -u "$workdir/source.counts" "$workdir/target.counts"; then
  fail "row counts differ between the source and the restore"
fi
rows=$(awk '{ total += $2 } END { print total }' "$workdir/source.counts")
echo "    $(wc -l <"$workdir/source.counts" | tr -d ' ') tables, $rows rows, identical"

echo "Restore drill passed in $(($(date +%s) - started)) s."
