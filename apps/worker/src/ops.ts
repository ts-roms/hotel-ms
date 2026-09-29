import {
  OPS_QUEUES,
  OPS_SNAPSHOT_INTERVAL_MS,
  OPS_SNAPSHOT_KEY,
  type OpsCommand,
  type OpsSnapshot,
} from '@hotel/contracts';
import type { PrismaClient } from '@hotel/database';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

/**
 * The ops dashboard's data (ADR-0029). This worker runs as the cross-tenant system role,
 * so it builds the snapshot and the API only serves it. Aggregates and error metadata only:
 * no job payloads, no guest or staff data.
 */

const iso = (d: Date | number | null | undefined) =>
  d === null || d === undefined ? null : new Date(d).toISOString();
const clip = (text: string | null | undefined, max = 300) =>
  text === null || text === undefined ? null : text.length > max ? `${text.slice(0, max)}…` : text;

export async function buildOpsSnapshot(
  system: PrismaClient,
  connection: Redis,
  options: { maxAttempts: number; schedulerRanAt: Date | null },
): Promise<OpsSnapshot> {
  const queues: OpsSnapshot['queues'] = [];
  const failedJobs: OpsSnapshot['failedJobs'] = [];
  for (const name of OPS_QUEUES) {
    const queue = new Queue(name, { connection });
    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
      queues.push({
        name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
      });
      for (const job of await queue.getFailed(0, 9)) {
        failedJobs.push({
          queue: name,
          id: String(job.id),
          name: job.name,
          reason: clip(job.failedReason) ?? '',
          attempts: job.attemptsMade,
          failedAt: iso(job.finishedOn),
        });
      }
    } finally {
      await queue.close();
    }
  }

  const max = options.maxAttempts;
  const [outbox] = await system.$queryRaw<
    { pending: bigint; oldest: Date | null; retrying: bigint; stuck: bigint }[]
  >`
    SELECT count(*) AS pending,
           min(occurred_at) AS oldest,
           count(*) FILTER (WHERE attempts > 0 AND attempts < ${max}) AS retrying,
           count(*) FILTER (WHERE attempts >= ${max}) AS stuck
      FROM outbox_events
     WHERE published_at IS NULL`;
  const outboxFailures = await system.$queryRaw<
    {
      id: string;
      organization_id: string;
      type: string;
      attempts: number;
      last_error: string | null;
      occurred_at: Date;
    }[]
  >`
    SELECT id, organization_id, type, attempts, last_error, occurred_at
      FROM outbox_events
     WHERE published_at IS NULL AND attempts > 0
     ORDER BY occurred_at DESC
     LIMIT 20`;

  const [webhooks] = await system.$queryRaw<
    { received: bigint; failed: bigint; unprocessed: bigint }[]
  >`
    SELECT count(*) FILTER (WHERE received_at > now() - interval '24 hours') AS received,
           count(*) FILTER (WHERE status = 'FAILED' AND received_at > now() - interval '24 hours') AS failed,
           count(*) FILTER (WHERE status = 'RECEIVED' AND received_at < now() - interval '5 minutes') AS unprocessed
      FROM webhook_events
     WHERE received_at > now() - interval '24 hours' OR status = 'RECEIVED'`;
  const webhookFailures = await system.$queryRaw<
    {
      id: string;
      provider: string;
      event_type: string;
      attempts: number;
      last_error: string | null;
      received_at: Date;
    }[]
  >`
    SELECT id, provider, event_type, attempts, last_error, received_at
      FROM webhook_events
     WHERE status = 'FAILED'
     ORDER BY received_at DESC
     LIMIT 20`;

  return {
    generatedAt: new Date().toISOString(),
    schedulerRanAt: iso(options.schedulerRanAt),
    queues,
    failedJobs,
    outbox: {
      pending: Number(outbox?.pending ?? 0),
      oldestPendingAt: iso(outbox?.oldest),
      retrying: Number(outbox?.retrying ?? 0),
      stuck: Number(outbox?.stuck ?? 0),
      maxAttempts: max,
      failures: outboxFailures.map((f) => ({
        id: f.id,
        organizationId: f.organization_id,
        type: f.type,
        attempts: f.attempts,
        lastError: clip(f.last_error),
        occurredAt: f.occurred_at.toISOString(),
      })),
    },
    webhooks: {
      received24h: Number(webhooks?.received ?? 0),
      failed24h: Number(webhooks?.failed ?? 0),
      unprocessed: Number(webhooks?.unprocessed ?? 0),
      failures: webhookFailures.map((f) => ({
        id: f.id,
        provider: f.provider,
        eventType: f.event_type,
        attempts: f.attempts,
        lastError: clip(f.last_error),
        receivedAt: f.received_at.toISOString(),
      })),
    },
  };
}

/** Writes the snapshot; it expires if the worker stops, which the dashboard shows. */
export async function publishOpsSnapshot(
  system: PrismaClient,
  connection: Redis,
  options: { maxAttempts: number; schedulerRanAt: Date | null },
): Promise<void> {
  const snapshot = await buildOpsSnapshot(system, connection, options);
  await connection.set(
    OPS_SNAPSHOT_KEY,
    JSON.stringify(snapshot),
    'PX',
    OPS_SNAPSHOT_INTERVAL_MS * 10,
  );
}

/** An operator's command from the dashboard. */
export async function runOpsCommand(
  system: PrismaClient,
  command: OpsCommand,
  log: Logger,
): Promise<{ changed: number }> {
  switch (command.type) {
    case 'outbox.retry': {
      // Gives a stuck event a fresh set of attempts; the relay picks it up again.
      const changed = await system.$executeRaw`
        UPDATE outbox_events SET attempts = 0, last_error = NULL
         WHERE id = ${command.eventId}::uuid AND published_at IS NULL`;
      log.info(
        { eventId: command.eventId, requestedBy: command.requestedBy, changed },
        'outbox event retried by operator',
      );
      return { changed };
    }
  }
}
