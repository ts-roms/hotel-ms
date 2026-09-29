# ADR-0009: API contracts and errors

- Status: Accepted, 2026-09-27
- Blueprint: §18

## Decision

- Zod schemas in `@hotel/contracts` are the single source of truth. The API validates with them
  (`@ZodBody`, `@ZodQuery`). The same decorators document them in OpenAPI. In the staff web
  app the sign-in, password and invitation forms validate with them too (`zodResolver`,
  `passwordSchema`); other forms, and the guest app, rely on the API's `400` problem details.
- **Request types come in two shapes.** `XRequest = z.infer<…>` is what the server works with
  after parsing, with every default filled in. Where a body schema has defaults (or
  transforms), `XRequestInput = z.input<…>` is what a client sends: defaulted fields may be
  left out. Clients type their request bodies with the `Input` type (added 2026-09-29; the
  existing names are unchanged, and a few earlier aliases such as `CreateEventInput` stay).
- Request objects are **strict**. Unknown fields such as a smuggled `organizationId` are
  rejected with `400`.
- Update schemas carry **no defaults**, so a PATCH never resets fields it omits. A regression
  test (`contracts/src/update-schemas.test.ts`) checks every exported `update…Schema`.
- Errors are RFC 9457 `application/problem+json` with a stable `code` and the `requestId`.
- Optimistic concurrency uses `ETag: W/"<version>"` and a required `If-Match`: `428` when
  missing, `412 VERSION_CONFLICT` when stale.
- `docs/api/openapi.json` is generated (`pnpm --filter @hotel/api openapi`) and checked in. CI
  fails if it is stale.
- `@hotel/api-client` is a thin client over contract types. Its request functions are generated
  from the OpenAPI document (`pnpm --filter @hotel/api-client generate`, checked in, CI fails if
  stale); the facades keep the contract types as the public request and response types
  (ADR-0034).
