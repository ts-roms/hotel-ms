import { z } from 'zod';
import { DOMAIN_EVENTS_QUEUE, NOTIFICATIONS_QUEUE, SMS_QUEUE, TENANT_JOBS_QUEUE } from './jobs.js';

/**
 * Operations dashboard (ADR-0029), for platform operators only. The worker, which already
 * runs as the cross-tenant system role, writes a snapshot to Redis every 30 seconds; the
 * API serves it and never gains cross-tenant database access. Operator actions go back to
 * the worker as commands. Nothing here carries job payloads or guest data.
 */

export const OPS_SNAPSHOT_KEY = 'ops:snapshot';
export const OPS_SNAPSHOT_INTERVAL_MS = 30_000;
/** Commands from the ops dashboard, run by the worker. */
export const OPS_COMMANDS_QUEUE = 'ops-commands';
/** The queues on the dashboard (the domain-events queue is the outbox relay's). */
export const OPS_QUEUES = [
  DOMAIN_EVENTS_QUEUE,
  NOTIFICATIONS_QUEUE,
  SMS_QUEUE,
  TENANT_JOBS_QUEUE,
] as const;
export type OpsQueue = (typeof OPS_QUEUES)[number];

export type OpsCommand = { type: 'outbox.retry'; eventId: string; requestedBy: string };

export const opsSnapshotSchema = z.object({
  generatedAt: z.iso.datetime(),
  /** When the worker last planned scheduled tenant jobs. */
  schedulerRanAt: z.iso.datetime().nullable(),
  queues: z.array(
    z.object({
      name: z.enum(OPS_QUEUES),
      waiting: z.number().int(),
      active: z.number().int(),
      delayed: z.number().int(),
      failed: z.number().int(),
    }),
  ),
  failedJobs: z.array(
    z.object({
      queue: z.enum(OPS_QUEUES),
      id: z.string(),
      name: z.string(),
      reason: z.string(),
      attempts: z.number().int(),
      failedAt: z.iso.datetime().nullable(),
    }),
  ),
  outbox: z.object({
    pending: z.number().int(),
    oldestPendingAt: z.iso.datetime().nullable(),
    /** Failed at least once, still being retried. */
    retrying: z.number().int(),
    /** Out of attempts: left for an operator. */
    stuck: z.number().int(),
    maxAttempts: z.number().int(),
    failures: z.array(
      z.object({
        id: z.uuid(),
        /** The worker's system role cannot read organization names (tenant data). */
        organizationId: z.uuid(),
        type: z.string(),
        attempts: z.number().int(),
        lastError: z.string().nullable(),
        occurredAt: z.iso.datetime(),
      }),
    ),
  }),
  webhooks: z.object({
    received24h: z.number().int(),
    failed24h: z.number().int(),
    /** Received more than 5 minutes ago and still unprocessed. */
    unprocessed: z.number().int(),
    failures: z.array(
      z.object({
        id: z.uuid(),
        provider: z.string(),
        eventType: z.string(),
        attempts: z.number().int(),
        lastError: z.string().nullable(),
        receivedAt: z.iso.datetime(),
      }),
    ),
  }),
});
export type OpsSnapshot = z.infer<typeof opsSnapshotSchema>;

export const opsOverviewSchema = z.object({
  /** Null when the worker has not reported for 5 minutes (it is down or cannot reach Redis). */
  snapshot: opsSnapshotSchema.nullable(),
});
export type OpsOverview = z.infer<typeof opsOverviewSchema>;
