import type { Prisma, PrismaClient } from './generated/prisma/client.js';

export type Tx = Prisma.TransactionClient;

/**
 * The database session context that RLS policies read (ADR-0003).
 *
 * `organizationId` must come from a trusted source: the server-side session, a verified
 * job payload, or provisioning code. Never from request input.
 */
export interface DbContext {
  organizationId: string | null;
  identityId: string | null;
  /** SHA-256 of an invitation token; exposes exactly that invitation (see RLS policy). */
  invitationTokenHash?: string | null;
  /** SHA-256 of a guest portal link token; exposes exactly that link. */
  guestLinkHash?: string | null;
  /** SHA-256 of a guest session token; exposes exactly that session. */
  guestSessionHash?: string | null;
}

export interface TransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
}

/**
 * Runs `fn` in a transaction whose RLS context is set with SET LOCAL semantics, so it is
 * discarded at commit/rollback and never leaks to the next user of a pooled connection.
 *
 * Tenant-owned tables are only reachable through this function when connected as the
 * runtime role. Without a context, RLS returns no rows (fail closed).
 */
export async function withDbContext<T>(
  prisma: PrismaClient,
  ctx: DbContext,
  fn: (tx: Tx) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.org_id', ${ctx.organizationId ?? ''}, true),
      set_config('app.identity_id', ${ctx.identityId ?? ''}, true),
      set_config('app.invitation_token_hash', ${ctx.invitationTokenHash ?? ''}, true),
      set_config('app.guest_link_hash', ${ctx.guestLinkHash ?? ''}, true),
      set_config('app.guest_session_hash', ${ctx.guestSessionHash ?? ''}, true)`;
    return fn(tx);
  }, options);
}
