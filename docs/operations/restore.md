# Restoring the database

A runbook for losing data or the database (ADR-0029). Read it before you need it, and rehearse
it: the restore drill below runs in CI on every push, and on staging every quarter.

## What protects the data

- **Automated backups with point-in-time recovery (PITR).** RDS keeps continuous backups for
  `db_backup_retention_days`: 7 days on staging, 35 in production. Any second in that window
  can be restored. The daily backup runs 02:00–03:00 Manila time.
- **Snapshots** are kept after the instance is deleted, and `copy_tags_to_snapshot` is on.
- **Deletion protection** is on (`db_deletion_protection`, default true).
- Documents, ID photos and selfies live in S3 (versioned, with the retention rules of ADR-0021),
  not in the database. A database restore does not bring back a deleted file, and a file
  restore does not need the database.

A restore always creates a **new instance**. The broken one stays untouched until you are
sure, so you can compare them or retry.

## Decide first

| Situation                                                   | Do this                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Bad data written at a known time (a bug, a wrong bulk edit) | PITR to just before it, then copy the rows back                        |
| Instance lost or corrupt                                    | PITR to the latest restorable time, then cut over                      |
| A migration went wrong                                      | Roll forward with a fixing migration if you can; PITR if data was lost |
| One tenant needs data back                                  | PITR to a scratch instance, export their rows only                     |

Tell people first. Write to the incident channel what happened, what you will restore, and the
expected downtime. For a cutover, put the site in maintenance mode by scaling `api` and
`worker` to zero, so nothing writes to the old instance meanwhile.

## 1. Restore to a new instance (point in time)

```bash
aws rds describe-db-instances --db-instance-identifier hotel-production --query 'DBInstances[0].LatestRestorableTime'
```

Pick the target time (UTC). For bad data, use a time just before it; the audit log's
`occurred_at` or the application logs usually tell you when it happened.

```bash
aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier hotel-production --target-db-instance-identifier hotel-production-restore --restore-time 2026-10-05T03:12:00Z --db-subnet-group-name <from terraform> --vpc-security-group-ids <db security group> --no-publicly-accessible
```

Use the same instance class, parameter group and KMS key as the Terraform instance (see
`infrastructure/terraform/modules/platform/data.tf`). Wait for it:

```bash
aws rds wait db-instance-available --db-instance-identifier hotel-production-restore
```

## 2. Check the restored instance

Run these checks from a one-off task in the VPC (the `migrate` task definition with a command
override, as for provisioning in `staging-setup.md`), pointed at the new instance:

- **Migrations:** `SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL` equals
  the number of folders in `packages/database/prisma/migrations` for the release that was
  running.
- **Tenant isolation:** every table with `organization_id` has row-level security enabled and
  forced, with a policy. The query is in `scripts/ops/restore-drill.sh` (step 4).
- **Privileges:** `app_rw` can read `reservations` but cannot delete `audit_logs` or grant
  `identities.platform_role`. The same step checks these.
- **Data:** the rows you expected are there. Check the latest `business_day_closings`, a known
  recent reservation, and `outbox_events` with `published_at IS NULL` (events waiting to be
  sent).

## 3a. Cut over (instance lost or corrupt)

1. Scale `api` and `worker` to zero if they are not already.
2. Point the application at the new instance. Update the `DATABASE_*` URLs in the app secret
   (`hotel-production/app`), or rename the instances so the old endpoint moves to the new one:
   rename the broken instance to `...-broken`, then rename the restored one to the original
   identifier.
3. Bring Terraform in line: `terraform import` the restored instance, or rename as above so the
   existing state matches, and run `terraform plan`. It should show no replacement.
4. Deploy the current release again (re-run **Deploy production** with the same SHA). This runs
   migrations (a no-op if the restore is current) and restarts every service.
5. Check the site: sign in, open the front desk, check the ops dashboard (queues draining, no
   stuck outbox events).
6. Keep the broken instance for a week, then delete it with a final snapshot.

Events that were in the outbox but not yet published at the restore time are published again
by the worker. Handlers are idempotent (keyed by event id), so this is safe.

## 3b. Copy rows back (bad data)

Keep production running. From a task in the VPC, read the rows you need from the restored
instance and write them back to production through a reviewed, idempotent script. Record the
repair in the incident notes. Never restore a whole table over live data: other tenants' rows
changed after the target time too.

Row-level security applies to every role except superusers and roles with BYPASSRLS. Reading
across tenants therefore needs the RDS master user, or a temporary role `WITH BYPASSRLS`
created for the repair and dropped afterwards.

## Logical backups (`pg_dump`)

RDS backups and PITR work at the storage level. A logical dump is useful for moving data or
for the drill, and it needs a role that **bypasses row-level security**: RLS is forced on tenant
tables, so even the owner role cannot read them all and the dump fails with "query would be
affected by row-level security policy". Use the master user, or a dedicated backup role
`WITH BYPASSRLS` that only has `SELECT`.

## The restore drill

`scripts/ops/restore-drill.sh` backs up a database with `pg_dump`, restores it into a scratch
database, and checks migrations, tenant isolation, privileges and exact row counts:

```bash
ADMIN_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/ops/restore-drill.sh
```

- **CI** runs it on every push against the seeded database (`restore-drill` step of the
  `verify` job).
- **Quarterly on staging**, run the PITR steps above for real: restore staging to a new
  instance, run the checks, then delete the instance. Record the time each step took; the total
  is the recovery time you can promise. Latest result: _not yet run on staging_.
