import { OPS_SNAPSHOT_KEY, opsSnapshotSchema } from '@hotel/contracts';
import { createPrismaClient, type PrismaClient, uuidv7, withDbContext } from '@hotel/database';
import { type DemoWorld, prepareTestDatabase, testDatabaseUrls } from '@hotel/database/testing';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpsSnapshot, publishOpsSnapshot, runOpsCommand } from '../src/ops.js';

let world: DemoWorld;
let app: PrismaClient;
let system: PrismaClient;
let connection: Redis;
const log = pino({ level: 'silent' });
const MAX = 20;

beforeAll(async () => {
  world = await prepareTestDatabase();
  const urls = testDatabaseUrls();
  app = createPrismaClient({ connectionString: urls.app, maxConnections: 2 });
  system = createPrismaClient({ connectionString: urls.system, maxConnections: 2 });
  const url = new URL(process.env.REDIS_QUEUE_URL ?? 'redis://localhost:56380');
  url.pathname = '/14';
  connection = new Redis(url.toString(), { maxRetriesPerRequest: null });
  await connection.flushdb();
});

afterAll(async () => {
  connection?.disconnect();
  await app?.$disconnect();
  await system?.$disconnect();
});

async function outboxEvent(type: string, attempts: number, lastError: string): Promise<string> {
  const id = uuidv7();
  await withDbContext(app, { organizationId: world.abc.organizationId, identityId: null }, (tx) =>
    tx.outboxEvent.create({
      data: {
        id,
        organizationId: world.abc.organizationId,
        type,
        payload: {},
        actorType: 'SYSTEM',
      },
    }),
  );
  await system.$executeRaw`
    UPDATE outbox_events SET attempts = ${attempts}, last_error = ${lastError} WHERE id = ${id}::uuid`;
  return id;
}

describe('ops snapshot', () => {
  let stuck: string;

  beforeAll(async () => {
    stuck = await outboxEvent('StuckEvent', MAX, 'handler exploded');
    await outboxEvent('FlakyEvent', 2, 'timeout');
    await app.webhookEvent.create({
      data: {
        provider: 'sandbox',
        eventId: `evt-${uuidv7()}`,
        eventType: 'payment.succeeded',
        signatureValid: true,
        payload: { secret: 'never shown' },
        status: 'FAILED',
        attempts: 3,
        lastError: 'Unknown payment reference',
      },
    });
    // A notification job that fails for good.
    const queue = new Queue('notifications', { connection });
    const failed = new Promise<void>((resolve) => {
      const worker = new Worker(
        'notifications',
        async () => {
          throw new Error('SES rejected the message');
        },
        { connection },
      );
      worker.on('failed', () => void worker.close().then(resolve));
    });
    await queue.add('password-reset', { to: 'guest@example.test' }, { attempts: 1 });
    await failed;
    await queue.close();
  });

  it('summarizes queues, the outbox and webhooks without payloads', async () => {
    const snapshot = await buildOpsSnapshot(system, connection, {
      maxAttempts: MAX,
      schedulerRanAt: null,
    });
    expect(opsSnapshotSchema.parse(snapshot)).toBeTruthy();

    expect(snapshot.queues.find((q) => q.name === 'notifications')?.failed).toBe(1);
    expect(snapshot.failedJobs).toEqual([
      expect.objectContaining({
        queue: 'notifications',
        name: 'password-reset',
        reason: 'SES rejected the message',
        attempts: 1,
      }),
    ]);
    expect(snapshot.outbox).toMatchObject({ retrying: 1, stuck: 1, maxAttempts: MAX });
    expect(snapshot.outbox.pending).toBeGreaterThanOrEqual(2);
    expect(snapshot.outbox.failures).toContainEqual(
      expect.objectContaining({
        id: stuck,
        type: 'StuckEvent',
        organizationId: world.abc.organizationId,
        attempts: MAX,
        lastError: 'handler exploded',
      }),
    );
    expect(snapshot.webhooks).toMatchObject({ failed24h: 1, received24h: 1, unprocessed: 0 });
    expect(snapshot.webhooks.failures[0]).toMatchObject({
      provider: 'sandbox',
      eventType: 'payment.succeeded',
      lastError: 'Unknown payment reference',
    });
    // Job data and webhook payloads never leave the worker.
    expect(JSON.stringify(snapshot)).not.toContain('guest@example.test');
    expect(JSON.stringify(snapshot)).not.toContain('never shown');
  });

  it('is published to Redis with an expiry', async () => {
    await publishOpsSnapshot(system, connection, { maxAttempts: MAX, schedulerRanAt: new Date() });
    const raw = await connection.get(OPS_SNAPSHOT_KEY);
    expect(opsSnapshotSchema.parse(JSON.parse(raw!)).schedulerRanAt).not.toBeNull();
    expect(await connection.pttl(OPS_SNAPSHOT_KEY)).toBeGreaterThan(0);
  });

  it('gives a stuck outbox event new attempts on an operator command', async () => {
    const result = await runOpsCommand(
      system,
      { type: 'outbox.retry', eventId: stuck, requestedBy: uuidv7() },
      log,
    );
    expect(result.changed).toBe(1);
    const snapshot = await buildOpsSnapshot(system, connection, {
      maxAttempts: MAX,
      schedulerRanAt: null,
    });
    expect(snapshot.outbox.stuck).toBe(0);
    // Published events are never touched.
    expect(
      (
        await runOpsCommand(
          system,
          { type: 'outbox.retry', eventId: uuidv7(), requestedBy: 'x' },
          log,
        )
      ).changed,
    ).toBe(0);
  });
});
