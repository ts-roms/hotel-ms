# ADR-0002: Stack, versions and module format

- Status: Accepted, 2026-09-27

## Decision

- **Node 22 LTS, pnpm 11 workspaces, Turborepo.** All packages are **ESM** (`"type": "module"`,
  `NodeNext`). NestJS 12 ships ESM-only, so the whole repo follows it.
- **TypeScript 6.0.x**, not 7.x. TS 7 is the new native compiler. Parts of the decorator
  metadata toolchain Nest relies on (`emitDecoratorMetadata`), and typescript-eslint
  (`<6.1`), do not support it yet. Move to 7 when both do.
- **NestJS 12 + Fastify 5.** `nestjs-zod` does not support Nest 12 yet, so Zod ↔ Nest
  integration is ~80 lines of our own (`apps/api/src/common/zod.ts`).
- **Prisma 7.10 (stable)**, with the `prisma-client` generator and the `@prisma/adapter-pg` driver
  adapter. The npm `latest` tag pointed at an 8.0 release candidate at the time; production
  pins stable releases.
- **Zod 4**, used for request validation, OpenAPI generation (`z.toJSONSchema`) and web forms.
- **Next.js 16** (App Router, Turbopack), React 19, Tailwind 4, TanStack Query 5, React
  Hook Form 7.
- **Vitest 5**. API tests use SWC (`unplugin-swc`) so decorator metadata is emitted.
- **Valkey 8** (Redis-compatible) and **PostgreSQL 17** locally. Managed equivalents in the cloud.

## Consequences

- Exact versions are pinned for Prisma and Next. Everything else uses caret ranges under the
  committed lockfile. Upgrades go through Renovate PRs with the full CI suite.
- Internal packages are consumed from their `dist/` build. Turborepo builds dependencies
  first (`dependsOn: ["^build"]`).
