import type { DomainEventEnvelope } from '@hotel/contracts';
import type { Logger } from 'pino';

/**
 * Integration event handlers. Every handler MUST be idempotent: delivery is
 * at-least-once, and BullMQ retries on failure (blueprint §17).
 *
 * Handlers run tenant work through withDbContext(app, { organizationId: event.organizationId })
 * with the runtime role, never with the system role.
 */
export type EventHandler = (event: DomainEventEnvelope, log: Logger) => Promise<void>;

export const HANDLERS: Record<string, EventHandler[]> = {
  // Events without a handler are consumed as no-ops. The API does its follow-up work in the
  // same transaction as the event (ADR-0031) and sends email and SMS through the
  // notification queue, so only work that must happen outside the API registers here.
  PropertyCreated: [
    async (event, log) => {
      log.info(
        { eventId: event.eventId, organizationId: event.organizationId },
        'property created',
      );
    },
  ],
};

export async function dispatch(event: DomainEventEnvelope, log: Logger): Promise<void> {
  const handlers = HANDLERS[event.type] ?? [];
  for (const handler of handlers) await handler(event, log);
}
