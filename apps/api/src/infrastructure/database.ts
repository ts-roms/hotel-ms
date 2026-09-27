import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  createPrismaClient,
  withDbContext,
  type PrismaClient,
  type TransactionOptions,
  type Tx,
} from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../common/request-context.js';
import { ENV, type Env } from '../config/env.js';

/**
 * Owns the runtime-role Prisma client. Only this module and TenantDb touch it directly.
 * Platform tables (identities, sessions) have no RLS and are accessed via `platform`.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createPrismaClient({
      connectionString: env.DATABASE_URL,
      applicationName: 'hotel-api',
      maxConnections: env.DATABASE_POOL_SIZE,
    });
  }

  /** Platform-level tables only (no organization_id). Tenant tables return nothing here. */
  get platform(): PrismaClient {
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}

/**
 * The way application code reaches tenant data. Every call runs in a transaction whose RLS
 * context comes from the verified request context, never from arguments.
 */
@Injectable()
export class TenantDb {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /** Tenant work for the verified organization of this request. */
  run<T>(fn: (tx: Tx) => Promise<T>, options?: TransactionOptions): Promise<T> {
    const organizationId = this.cls.get('organizationId');
    if (!organizationId) {
      // A programming error (route missing tenant context), not a client error.
      throw new Error('TenantDb.run called without a verified organization context');
    }
    return withDbContext(
      this.prisma.client,
      { organizationId, identityId: this.cls.get('identityId') ?? null },
      fn,
      options,
    );
  }

  /** Identity-only context: the caller's own memberships and their organizations. */
  runAsIdentity<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const identityId = this.cls.get('identityId');
    if (!identityId) throw new Error('TenantDb.runAsIdentity called without an identity');
    return withDbContext(this.prisma.client, { organizationId: null, identityId }, fn);
  }

  /** No tenant or identity: only the invitation matching this token hash is visible. */
  runWithInvitationToken<T>(tokenHash: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withDbContext(
      this.prisma.client,
      { organizationId: null, identityId: null, invitationTokenHash: tokenHash },
      fn,
    );
  }

  /** No tenant: only the guest portal link / guest session matching the hash is visible. */
  runWithGuestToken<T>(
    lookup: { guestLinkHash: string } | { guestSessionHash: string },
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return withDbContext(
      this.prisma.client,
      { organizationId: null, identityId: null, ...lookup },
      fn,
    );
  }

  /**
   * Explicit context for the few places that establish tenancy themselves (TenantGuard
   * verifying the session's organization, login). The organizationId MUST come from
   * server-side state.
   */
  runWithTrustedContext<T>(
    ctx: { organizationId: string; identityId: string | null },
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return withDbContext(this.prisma.client, ctx, fn);
  }
}
