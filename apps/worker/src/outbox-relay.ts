import type { DomainEventEnvelope } from '@hotel/contracts';
import type { PrismaClient } from '@hotel/database';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';

export const DOMAIN_EVENTS_QUEUE = 'domain-events';

interface OutboxRow {
  id: string;
  organization_id: string;
  property_id: string | null;
  type: string;
  version: number;
  payload: unknown;
  actor_type: string;
  actor_id: string | null;
  correlation_id: string | null;
  occurred_at: Date;
  attempts: number;
}

export interface RelayOptions {
  batchSize?: number;
  /** After this many failed publish attempts an event is left for manual inspection. */
  maxAttempts?: number;
}

/**
 * Transactional-outbox relay (ADR-0005). Runs with the `app_system` role, which can see
 * outbox rows of every tenant and nothing else.
 *
 * At-least-once: the BullMQ job id is the event id, so a crash between enqueue and
 * marking the row published results in a no-op re-enqueue, not a duplicate job.
 * FOR UPDATE SKIP LOCKED lets several relay instances run side by side.
 */
/** After this many failed publishes an event waits for an operator (ops dashboard). */
export const OUTBOX_MAX_ATTEMPTS = 20;

export async function relayOutboxBatch(
  system: PrismaClient,
  queue: Queue,
  log: Logger,
  options: RelayOptions = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 100;
  const maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;

  return system.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT id, organization_id, property_id, type, version, payload, actor_type, actor_id,
               correlation_id, occurred_at, attempts
        FROM outbox_events
        WHERE published_at IS NULL AND attempts < ${maxAttempts}
        ORDER BY occurred_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED`;

      let published = 0;
      for (const row of rows) {
        const envelope: DomainEventEnvelope = {
          eventId: row.id,
          type: row.type,
          version: row.version,
          occurredAt: row.occurred_at.toISOString(),
          organizationId: row.organization_id,
          propertyId: row.property_id,
          actor: { type: row.actor_type, id: row.actor_id },
          correlationId: row.correlation_id,
          payload: row.payload,
        };
        try {
          await queue.add(row.type, envelope, {
            jobId: row.id,
            attempts: 10,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: { age: 24 * 3600, count: 10_000 },
            removeOnFail: false,
          });
          await tx.$executeRaw`UPDATE outbox_events SET published_at = now(), attempts = attempts + 1 WHERE id = ${row.id}::uuid`;
          published++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await tx.$executeRaw`UPDATE outbox_events SET attempts = attempts + 1, last_error = ${message.slice(0, 1000)} WHERE id = ${row.id}::uuid`;
          log.error({ eventId: row.id, type: row.type, err: error }, 'outbox publish failed');
        }
      }
      return published;
    },
    { timeout: 30_000 },
  );
}
