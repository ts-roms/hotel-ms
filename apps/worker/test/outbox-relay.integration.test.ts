import { createPrismaClient, type PrismaClient, uuidv7, withDbContext } from '@hotel/database';
import { prepareTestDatabase, testDatabaseUrls } from '@hotel/database/testing';
import type { DemoWorld } from '@hotel/database';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relayOutboxBatch } from '../src/outbox-relay.js';

let world: DemoWorld;
let app: PrismaClient;
let system: PrismaClient;
let connection: Redis;
let queue: Queue;
const log = pino({ level: 'silent' });

beforeAll(async () => {
  world = await prepareTestDatabase();
  const urls = testDatabaseUrls();
  app = createPrismaClient({ connectionString: urls.app, maxConnections: 2 });
  system = createPrismaClient({ connectionString: urls.system, maxConnections: 2 });
  const url = new URL(process.env.REDIS_QUEUE_URL ?? 'redis://localhost:56380');
  url.pathname = '/15';
  connection = new Redis(url.toString(), { maxRetriesPerRequest: null });
  await connection.flushdb();
  queue = new Queue('test-domain-events', { connection });
});

afterAll(async () => {
  await queue?.close();
  connection?.disconnect();
  await app?.$disconnect();
  await system?.$disconnect();
});

async function enqueue(organizationId: string, type: string): Promise<string> {
  const id = uuidv7();
  await withDbContext(app, { organizationId, identityId: null }, (tx) =>
    tx.outboxEvent.create({
      data: { id, organizationId, type, payload: { n: 1 }, actorType: 'SYSTEM' },
    }),
  );
  return id;
}

describe('outbox relay', () => {
  it('publishes committed events from every tenant exactly once, keyed by event id', async () => {
    const a = await enqueue(world.abc.organizationId, 'TestEvent');
    const b = await enqueue(world.xyz.organizationId, 'TestEvent');

    const published = await relayOutboxBatch(system, queue, log);
    expect(published).toBe(2);

    const jobA = await queue.getJob(a);
    const jobB = await queue.getJob(b);
    expect(jobA?.data.organizationId).toBe(world.abc.organizationId);
    expect(jobB?.data.organizationId).toBe(world.xyz.organizationId);

    // Second pass finds nothing left to publish.
    expect(await relayOutboxBatch(system, queue, log)).toBe(0);
  });

  it('never publishes events whose transaction rolled back', async () => {
    const id = uuidv7();
    await expect(
      withDbContext(
        app,
        { organizationId: world.abc.organizationId, identityId: null },
        async (tx) => {
          await tx.outboxEvent.create({
            data: {
              id,
              organizationId: world.abc.organizationId,
              type: 'RolledBack',
              payload: {},
              actorType: 'SYSTEM',
            },
          });
          throw new Error('business rule failed');
        },
      ),
    ).rejects.toThrow('business rule failed');

    await relayOutboxBatch(system, queue, log);
    expect(await queue.getJob(id)).toBeUndefined();
  });

  it('re-publishing the same event id does not create a duplicate job', async () => {
    const id = await enqueue(world.abc.organizationId, 'Dup');
    await relayOutboxBatch(system, queue, log);
    // Simulate a crash after enqueue but before marking published.
    const owner = createPrismaClient({
      connectionString: testDatabaseUrls().owner,
      maxConnections: 1,
    });
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`ALTER TABLE outbox_events NO FORCE ROW LEVEL SECURITY`;
      await tx.$executeRaw`UPDATE outbox_events SET published_at = NULL WHERE id = ${id}::uuid`;
      await tx.$executeRaw`ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY`;
    });
    await owner.$disconnect();

    await relayOutboxBatch(system, queue, log);
    const counts = await queue.getJobCounts();
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    expect(jobs.filter((j) => j.id === id)).toHaveLength(1);
    expect(total).toBe(jobs.length);
  });
});
