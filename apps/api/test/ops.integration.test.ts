/**
 * Ops dashboard (ADR-0029): platform operators only, with two-step verification; the API
 * serves the worker's snapshot and forwards retries. The runtime database role can never
 * make anyone an operator.
 */
import { OPS_COMMANDS_QUEUE, OPS_SNAPSHOT_KEY, type OpsSnapshot } from '@hotel/contracts';
import { createPrismaClient, uuidv7 } from '@hotel/database';
import { testDatabaseUrls } from '@hotel/database/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV, type Env } from '../src/config/env.js';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let redis: Redis;
/** Robert (auditor) is also a platform operator here. */
const OPERATOR = 'robert.finance@abc.test';

const owner = () =>
  createPrismaClient({ connectionString: testDatabaseUrls().owner, maxConnections: 1 });

async function setOperator(email: string, on: boolean) {
  const db = owner();
  try {
    await db.identity.update({ where: { email }, data: { platformRole: on ? 'OPERATOR' : null } });
  } finally {
    await db.$disconnect();
  }
}

const snapshot: OpsSnapshot = {
  generatedAt: new Date().toISOString(),
  schedulerRanAt: null,
  queues: [{ name: 'notifications', waiting: 0, active: 0, delayed: 0, failed: 1 }],
  failedJobs: [],
  outbox: {
    pending: 0,
    oldestPendingAt: null,
    retrying: 0,
    stuck: 0,
    maxAttempts: 20,
    failures: [],
  },
  webhooks: { received24h: 0, failed24h: 0, unprocessed: 0, failures: [] },
};

beforeAll(async () => {
  ctx = await startTestApp();
  await setOperator(OPERATOR, true);
  redis = new Redis(ctx.app.get<Env>(ENV).REDIS_QUEUE_URL, { maxRetriesPerRequest: null });
});
afterAll(async () => {
  await redis?.del(OPS_SNAPSHOT_KEY);
  redis?.disconnect();
  await setOperator(OPERATOR, false);
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('ops dashboard', () => {
  it('does not exist for anyone but an operator with two-step verification', async () => {
    const admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
    expect((await admin.get('/api/v1/ops/overview')).status).toBe(404);
    expect((await admin.get('/api/v1/auth/session')).body.identity.platformOperator).toBe(false);

    const withoutMfa = await TestClient.as(ctx.app, OPERATOR);
    expect((await withoutMfa.get('/api/v1/ops/overview')).status).toBe(404);
    expect((await withoutMfa.get('/api/v1/auth/session')).body.identity.platformOperator).toBe(
      false,
    );
    expect((await new TestClient(ctx.app).get('/api/v1/ops/overview')).status).toBe(401);
  });

  it("serves the worker's snapshot, or null when the worker has gone quiet", async () => {
    const operator = await TestClient.withMfa(ctx.app, OPERATOR);
    expect((await operator.get('/api/v1/auth/session')).body.identity.platformOperator).toBe(true);

    await redis.del(OPS_SNAPSHOT_KEY);
    expect((await operator.get('/api/v1/ops/overview')).body).toEqual({ snapshot: null });

    await redis.set(OPS_SNAPSHOT_KEY, JSON.stringify(snapshot), 'EX', 60);
    const res = await operator.get('/api/v1/ops/overview');
    expect(res.status).toBe(200);
    expect(res.body.snapshot).toEqual(snapshot);
  });

  it('forwards retries: failed jobs directly, stuck outbox events to the worker', async () => {
    const operator = await TestClient.withMfa(ctx.app, OPERATOR);
    expect((await operator.request('POST', '/api/v1/ops/queues/nope/jobs/1/retry')).status).toBe(
      404,
    );
    expect(
      (await operator.request('POST', '/api/v1/ops/queues/notifications/jobs/missing/retry'))
        .status,
    ).toBe(404);

    const eventId = uuidv7();
    const res = await operator.request('POST', `/api/v1/ops/outbox/${eventId}/retry`);
    expect(res.status).toBe(202);
    const commands = new Queue(OPS_COMMANDS_QUEUE, { connection: redis });
    try {
      const waiting = await commands.getWaiting();
      expect(waiting.map((j) => j.data)).toContainEqual(
        expect.objectContaining({ type: 'outbox.retry', eventId }),
      );
    } finally {
      await commands.obliterate({ force: true });
      await commands.close();
    }
  });

  it('cannot be granted by the runtime database role', async () => {
    const appDb = createPrismaClient({
      connectionString: testDatabaseUrls().app,
      maxConnections: 1,
    });
    try {
      await expect(
        appDb.$executeRaw`UPDATE identities SET platform_role = 'OPERATOR' WHERE email = 'admin@abc.test'`,
      ).rejects.toThrow(/permission denied/);
      // Ordinary identity updates still work.
      await expect(
        appDb.$executeRaw`UPDATE identities SET failed_login_count = 0 WHERE email = 'admin@abc.test'`,
      ).resolves.toBe(1);
    } finally {
      await appDb.$disconnect();
    }
  });
});
