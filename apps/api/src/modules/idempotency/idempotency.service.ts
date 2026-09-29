import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { Prisma } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { TenantDb } from '../../infrastructure/database.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';

/** OpenAPI: the Idempotency-Key header an idempotent route requires. */
export const idempotencyKeyHeader = ApiHeader({
  name: 'Idempotency-Key',
  required: true,
  description: 'Unique per attempt; retries reuse it',
});

const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;
const TTL_MS = 24 * 3600_000;
/** An IN_PROGRESS record older than this is treated as abandoned (crashed request). */
const STALE_MS = 60_000;

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Idempotency-Key handling (ADR-0009): the first request with a key runs; repeats with the
 * same key and body get the stored response; the same key with a different body is 422.
 * Keys are scoped per member (or guest session) and operation, so two users cannot collide.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly db: TenantDb,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async run<T>(
    operation: string,
    key: string | undefined,
    requestBody: unknown,
    fn: () => Promise<{ status: number; body: T }>,
  ): Promise<IdempotentResult<T>> {
    if (!key || !KEY_RE.test(key)) {
      throw Problems.validation([
        {
          path: 'Idempotency-Key',
          message: 'Header required: 8-100 chars of letters, digits, - or _',
        },
      ]);
    }
    const organizationId = this.cls.get('organizationId')!;
    // Scoped per principal: a staff member, or one guest session.
    const guest = this.cls.get('guest');
    const principal = this.cls.get('membershipId') ?? (guest ? `guest:${guest.sessionId}` : null);
    if (!principal) throw new Error('Idempotency requires an authenticated principal');
    const scope = `${principal}:${operation}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(requestBody ?? null))
      .digest('hex');
    const id = { organizationId_scope_key: { organizationId, scope, key } };

    const claim = await this.db
      .run(async (tx) => {
        const existing = await tx.idempotencyKey.findUnique({ where: id });
        const expiresAt = new Date(Date.now() + TTL_MS);
        if (!existing) {
          // create (not upsert): of two concurrent first requests, one gets P2002 below.
          await tx.idempotencyKey.create({
            data: { organizationId, scope, key, requestHash, status: 'IN_PROGRESS', expiresAt },
          });
          return { kind: 'run' as const };
        }
        if (existing.expiresAt <= new Date()) {
          await tx.idempotencyKey.update({
            where: id,
            data: {
              requestHash,
              status: 'IN_PROGRESS',
              responseStatus: null,
              responseBody: Prisma.DbNull,
              createdAt: new Date(),
              expiresAt,
            },
          });
          return { kind: 'run' as const };
        }
        if (existing.requestHash !== requestHash) return { kind: 'mismatch' as const };
        if (existing.status === 'COMPLETED') {
          return {
            kind: 'replay' as const,
            status: existing.responseStatus!,
            body: existing.responseBody as T,
          };
        }
        if (Date.now() - existing.createdAt.getTime() < STALE_MS)
          return { kind: 'in-progress' as const };
        await tx.idempotencyKey.update({ where: id, data: { createdAt: new Date() } });
        return { kind: 'run' as const };
      })
      .catch((error: unknown) => {
        // Two first requests racing on the same key: the loser sees the unique violation.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return { kind: 'in-progress' as const };
        }
        throw error;
      });

    if (claim.kind === 'mismatch') {
      throw new ProblemException(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key reused',
        'This key was used with a different request body.',
      );
    }
    if (claim.kind === 'in-progress') {
      throw new ProblemException(
        409,
        'IDEMPOTENCY_IN_PROGRESS',
        'Request in progress',
        'A request with this key is still being processed.',
      );
    }
    if (claim.kind === 'replay') return { status: claim.status, body: claim.body, replayed: true };

    try {
      const result = await fn();
      await this.db.run((tx) =>
        tx.idempotencyKey.update({
          where: id,
          data: {
            status: 'COMPLETED',
            responseStatus: result.status,
            responseBody: result.body as Prisma.InputJsonValue,
          },
        }),
      );
      return { ...result, replayed: false };
    } catch (error) {
      // Failed requests do not consume the key: the client may fix and retry.
      await this.db.run((tx) => tx.idempotencyKey.delete({ where: id })).catch(() => undefined);
      throw error;
    }
  }

  /**
   * run() for a controller: responds with `status` and marks a replayed response with
   * `Idempotent-Replayed: true`.
   */
  async respond<T>(
    reply: { header(name: string, value: string): unknown },
    operation: string,
    key: string | undefined,
    requestBody: unknown,
    status: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const result = await this.run(operation, key, requestBody, async () => ({
      status,
      body: await fn(),
    }));
    if (result.replayed) reply.header('idempotent-replayed', 'true');
    return result.body;
  }
}
