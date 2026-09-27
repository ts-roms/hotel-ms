import { setTimeout as sleep } from 'node:timers/promises';
import type { DomainEventEnvelope } from '@hotel/contracts';
import { createPrismaClient } from '@hotel/database';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { z } from 'zod';
import { dispatch } from './handlers.js';
import { DOMAIN_EVENTS_QUEUE, relayOutboxBatch } from './outbox-relay.js';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_SYSTEM_URL: z.url(),
    REDIS_QUEUE_URL: z.url(),
    LOG_LEVEL: z.string().default('info'),
    OUTBOX_POLL_MS: z.coerce.number().int().min(50).default(500),
  })
  .parse(process.env);

const log = pino({
  level: env.LOG_LEVEL,
  base: { service: 'worker' },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
    : {}),
});

// BullMQ requires maxRetriesPerRequest: null on its connections.
const connection = new Redis(env.REDIS_QUEUE_URL, { maxRetriesPerRequest: null });
const system = createPrismaClient({
  connectionString: env.DATABASE_SYSTEM_URL,
  applicationName: 'hotel-outbox-relay',
  maxConnections: 2,
});

const queue = new Queue(DOMAIN_EVENTS_QUEUE, { connection });
const worker = new Worker<DomainEventEnvelope>(
  DOMAIN_EVENTS_QUEUE,
  async (job) => {
    const eventLog = log.child({
      eventId: job.data.eventId,
      type: job.data.type,
      organizationId: job.data.organizationId,
      correlationId: job.data.correlationId,
    });
    await dispatch(job.data, eventLog);
  },
  { connection, concurrency: 10 },
);
worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'event handler failed'));

let running = true;
async function relayLoop(): Promise<void> {
  while (running) {
    try {
      const published = await relayOutboxBatch(system, queue, log);
      if (published > 0) log.debug({ published }, 'outbox batch relayed');
      // Drain quickly when there is backlog; poll otherwise.
      if (published === 0) await sleep(env.OUTBOX_POLL_MS);
    } catch (error) {
      log.error({ err: error }, 'outbox relay error');
      await sleep(env.OUTBOX_POLL_MS * 4);
    }
  }
}

const relay = relayLoop();
log.info('worker started');

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutting down');
  running = false;
  await relay;
  await worker.close();
  await queue.close();
  await system.$disconnect();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
