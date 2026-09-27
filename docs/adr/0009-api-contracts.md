# ADR-0009: API contracts and errors

- Status: Accepted, 2026-09-27
- Blueprint: §18

## Decision

- Zod schemas in `@hotel/contracts` are the single source of truth. The API validates with them
  (`@ZodBody`, `@ZodQuery`). The same decorators document them in OpenAPI. The web app
  validates forms with them.
- Request objects are **strict**. Unknown fields such as a smuggled `organizationId` are
  rejected with `400`.
- Update schemas carry **no defaults**, so a PATCH never resets fields it omits. A regression
  test covers this.
- Errors are RFC 9457 `application/problem+json` with a stable `code` and the `requestId`.
- Optimistic concurrency uses `ETag: W/"<version>"` and a required `If-Match`: `428` when
  missing, `412 VERSION_CONFLICT` when stale.
- `docs/api/openapi.json` is generated (`pnpm --filter @hotel/api openapi`) and checked in. CI
  fails if it is stale.
- `@hotel/api-client` is a thin hand-written client over contract types for now. Switch to
  generation from the OpenAPI document (orval) when the surface grows past a few resources.
