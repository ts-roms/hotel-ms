# Database conventions

Read this before adding a table. The reasoning is in ADR-0003 and blueprint §7.

## Checklist for a new table

1. **Decide the owner:** platform, organization, property, or child of another tenant table.
   Add it to the ownership map in the blueprint (§7.2).
2. **Tenant-owned?** Add `organizationId String @map("organization_id") @db.Uuid`.
3. **Property-owned?** Add `propertyId` and reference the property with the composite key:
   `@relation(fields: [organizationId, propertyId], references: [organizationId, id])`.
4. **Will other tables reference it?** Add `@@unique([organizationId, id])`.
5. **Write a migration** with `pnpm db:migrate:dev --create-only --name <name>`, then add by hand:
   - `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy `TO app_rw`
   - `GRANT` statements. Append-only tables get `SELECT, INSERT` only.
   - CHECK constraints, partial indexes, exclusion constraints
6. Run `pnpm db:migrate:dev`, then check that
   `pnpm --filter @hotel/database exec prisma migrate diff --from-config-datasource --to-schema prisma/schema`
   is empty. CI enforces this.
7. `pnpm test:integration`. The RLS coverage test fails if step 5 was missed.

## Types

| Kind                   | Column                                                   |
| ---------------------- | -------------------------------------------------------- |
| ids                    | `uuid` v7 (`@default(uuid(7))`)                          |
| instants               | `timestamptz(3)`                                         |
| hotel dates            | `date`                                                   |
| money                  | `bigint amount_minor` + `char(3) currency` (never float) |
| wall-clock policy time | `varchar(5)` `HH:mm` + CHECK                             |

## Things Prisma must not see

Prisma's diff ignores CHECK constraints, partial indexes, policies, triggers and functions.
It does **not** ignore `NULLS NOT DISTINCT` indexes. Use two partial unique indexes instead.

## Never

- `$queryRawUnsafe` / `$executeRawUnsafe` in application code (ESLint enforces this).
- Creating a Prisma client outside `apps/api/src/infrastructure/database.ts`, the worker
  entry point or `packages/database`.
- `prisma migrate reset` against anything but a local throwaway database.
