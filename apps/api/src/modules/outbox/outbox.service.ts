import { Injectable } from '@nestjs/common';
import type { DomainEventPayloads, DomainEventType } from '@hotel/contracts';
import { type Prisma, type Tx, uuidv7 } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { actorOf } from '../../common/actor.js';
import type { RequestContext } from '../../common/request-context.js';

/**
 * Transactional outbox writer (ADR-0005). Events are persisted in the caller's
 * transaction; the worker's relay publishes them after commit. An event can therefore
 * never be published for a change that rolled back, nor lost for one that committed.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  async enqueue<T extends DomainEventType>(
    tx: Tx,
    type: T,
    payload: DomainEventPayloads[T],
    options: { propertyId?: string | null; version?: number } = {},
  ): Promise<string> {
    const organizationId = this.cls.get('organizationId');
    if (!organizationId) throw new Error('Outbox event without organization context');
    const id = uuidv7();
    await tx.outboxEvent.create({
      data: {
        id,
        organizationId,
        propertyId: options.propertyId ?? null,
        type,
        version: options.version ?? 1,
        payload: payload as unknown as Prisma.InputJsonValue,
        ...actorOf(this.cls),
        correlationId: this.cls.get('requestId') ?? null,
      },
    });
    return id;
  }
}
