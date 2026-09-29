import { setTimeout as sleep } from 'node:timers/promises';
import {
  DOMAIN_EVENTS_QUEUE,
  type DomainEventEnvelope,
  type EmailJob,
  NOTIFICATIONS_QUEUE,
  OPS_COMMANDS_QUEUE,
  OPS_SNAPSHOT_INTERVAL_MS,
  type OpsCommand,
  SMS_QUEUE,
  type SmsJob,
  TENANT_JOBS_QUEUE,
  type TenantJob,
} from '@hotel/contracts';
import { createPrismaClient } from '@hotel/database';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { z } from 'zod';
import { deliverEmail } from './email/deliver.js';
import { createTransport } from './email/transports.js';
import { flushErrorReporting, initErrorReporting, reportError } from './error-reporting.js';
import { dispatch } from './handlers.js';
import { publishOpsSnapshot, runOpsCommand } from './ops.js';
import { OUTBOX_MAX_ATTEMPTS, relayOutboxBatch } from './outbox-relay.js';
import { planTenantJobs } from './scheduler.js';
import { createSmsTransport, deliverSms } from './sms.js';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_SYSTEM_URL: z.url(),
    REDIS_QUEUE_URL: z.url(),
    LOG_LEVEL: z.string().default('info'),
    OUTBOX_POLL_MS: z.coerce.number().int().min(50).default(500),
    /** How often the scheduler checks the clock for due tenant jobs (ADR-0017). */
    SCHEDULER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .default(5 * 60_000),
    EMAIL_TRANSPORT: z.enum(['file', 'ses']).default('file'),
    EMAIL_FROM: z.string().min(3),
    MAIL_DIR: z.string().default('.mail'),
    AWS_REGION: z.string().optional(),
    SES_CONFIGURATION_SET: z.string().optional(),
    SMS_TRANSPORT: z.enum(['file', 'sns']).default('file'),
    /** Alphanumeric sender id where the destination country allows it. */
    SMS_SENDER_ID: z.string().max(11).optional(),
    /** Error tracking (ADR-0029). Unset: errors are only logged. */
    SENTRY_DSN: z.url().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    RELEASE: z.string().optional(),
  })
  .parse(process.env);

const log = pino({
  level: env.LOG_LEVEL,
  base: { service: 'worker' },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
    : {}),
});

initErrorReporting({
  dsn: env.SENTRY_DSN,
  environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
  release: env.RELEASE,
  service: 'worker',
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
worker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err }, 'event handler failed');
  reportError(err, {
    queue: DOMAIN_EVENTS_QUEUE,
    jobId: job?.id,
    eventType: job?.data.type,
    organizationId: job?.data.organizationId,
  });
});

const transport = createTransport(env);
const mailer = new Worker<EmailJob>(
  NOTIFICATIONS_QUEUE,
  (job) => deliverEmail(job.data, transport, env.EMAIL_FROM, log.child({ jobId: job.id })),
  // Provider rate limits (SES sandbox: 1/s; production quotas are higher).
  { connection, concurrency: 5, limiter: { max: 10, duration: 1000 } },
);
mailer.on('failed', (job, err) => {
  log.error(
    { jobId: job?.id, template: job?.data.template, attempts: job?.attemptsMade, err },
    'email delivery failed',
  );
  reportError(err, {
    queue: NOTIFICATIONS_QUEUE,
    jobId: job?.id,
    template: job?.data.template,
    attempts: job?.attemptsMade,
  });
});

const smsTransport = createSmsTransport(env);
const texter = new Worker<SmsJob>(
  SMS_QUEUE,
  (job) => deliverSms(job.data, smsTransport, log.child({ jobId: job.id })),
  { connection, concurrency: 5, limiter: { max: 5, duration: 1000 } },
);
texter.on('failed', (job, err) => {
  log.error({ jobId: job?.id, attempts: job?.attemptsMade, err }, 'sms delivery failed');
  reportError(err, { queue: SMS_QUEUE, jobId: job?.id, attempts: job?.attemptsMade });
});

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
      reportError(error, { component: 'outbox-relay' });
      await sleep(env.OUTBOX_POLL_MS * 4);
    }
  }
}

const relay = relayLoop();

const tenantJobs = new Queue<TenantJob>(TENANT_JOBS_QUEUE, { connection });
let schedulerRanAt: Date | null = null;
async function plan(): Promise<void> {
  try {
    await planTenantJobs(system, tenantJobs, log);
    schedulerRanAt = new Date();
  } catch (error) {
    log.error({ err: error }, 'scheduler planning failed');
    reportError(error, { component: 'scheduler' });
  }
}
void plan();
const scheduler = setInterval(() => void plan(), env.SCHEDULER_INTERVAL_MS);

// Ops dashboard (ADR-0029): a snapshot for operators, and their commands.
async function snapshot(): Promise<void> {
  try {
    await publishOpsSnapshot(system, connection, {
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      schedulerRanAt,
    });
  } catch (error) {
    log.error({ err: error }, 'ops snapshot failed');
    reportError(error, { component: 'ops-snapshot' });
  }
}
void snapshot();
const snapshots = setInterval(() => void snapshot(), OPS_SNAPSHOT_INTERVAL_MS);
const opsCommands = new Worker<OpsCommand>(
  OPS_COMMANDS_QUEUE,
  async (job) => {
    const result = await runOpsCommand(system, job.data, log);
    void snapshot();
    return result;
  },
  { connection, concurrency: 1 },
);
log.info({ emailTransport: transport.name, smsTransport: smsTransport.name }, 'worker started');

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutting down');
  running = false;
  clearInterval(scheduler);
  clearInterval(snapshots);
  await opsCommands.close();
  await relay;
  await tenantJobs.close();
  await worker.close();
  await mailer.close();
  await texter.close();
  await queue.close();
  await system.$disconnect();
  connection.disconnect();
  await flushErrorReporting();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
