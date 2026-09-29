import type { Tx } from '@hotel/database';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../common/request-context.js';
import { OutboxService } from './outbox.service.js';

const ORG = '01900000-0000-7000-8000-000000000001';
const PROPERTY = '01900000-0000-7000-8000-000000000002';
const IDENTITY = '01900000-0000-7000-8000-000000000003';
const GUEST = '01900000-0000-7000-8000-000000000004';

/** A request context holding just the given fields. */
const clsWith = (store: Partial<RequestContext>) =>
  ({ get: (key: keyof RequestContext) => store[key] }) as unknown as ClsService<RequestContext>;

/** A transaction that records outbox rows instead of writing them. */
const fakeTx = () => {
  const create = vi.fn().mockResolvedValue({});
  return { tx: { outboxEvent: { create } } as unknown as Tx, create };
};

const payload = { propertyId: PROPERTY, code: 'MNL', name: 'ABC Hotel Manila' };

describe('OutboxService.enqueue', () => {
  it("writes the event in the caller's transaction with the request's actor and correlation", async () => {
    const outbox = new OutboxService(
      clsWith({ organizationId: ORG, identityId: IDENTITY, requestId: 'req-123' }),
    );
    const { tx, create } = fakeTx();

    const id = await outbox.enqueue(tx, 'PropertyCreated', payload, { propertyId: PROPERTY });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toEqual({
      data: {
        id,
        organizationId: ORG,
        propertyId: PROPERTY,
        type: 'PropertyCreated',
        version: 1,
        payload,
        actorType: 'MEMBER',
        actorId: IDENTITY,
        correlationId: 'req-123',
      },
    });
  });

  it('returns a fresh time-ordered (v7) id per event', async () => {
    const outbox = new OutboxService(clsWith({ organizationId: ORG }));
    const { tx } = fakeTx();
    const first = await outbox.enqueue(tx, 'PropertyCreated', payload);
    const second = await outbox.enqueue(tx, 'PropertyCreated', payload);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
    expect(second > first).toBe(true);
  });

  it('defaults to an organization-level event, version 1, no correlation id', async () => {
    const outbox = new OutboxService(clsWith({ organizationId: ORG }));
    const { tx, create } = fakeTx();
    await outbox.enqueue(tx, 'PropertyCreated', payload);
    expect(create.mock.calls[0]![0].data).toMatchObject({
      propertyId: null,
      version: 1,
      correlationId: null,
      actorType: 'MEMBER',
      actorId: null,
    });
  });

  it('keeps an explicit schema version', async () => {
    const outbox = new OutboxService(clsWith({ organizationId: ORG }));
    const { tx, create } = fakeTx();
    await outbox.enqueue(tx, 'PropertyCreated', payload, { version: 3, propertyId: null });
    expect(create.mock.calls[0]![0].data).toMatchObject({ version: 3, propertyId: null });
  });

  it('attributes webhook work to the system and guest-portal work to the guest', async () => {
    const system = fakeTx();
    await new OutboxService(
      clsWith({ organizationId: ORG, identityId: IDENTITY, system: true }),
    ).enqueue(system.tx, 'PropertyCreated', payload);
    expect(system.create.mock.calls[0]![0].data).toMatchObject({
      actorType: 'SYSTEM',
      actorId: null,
    });

    const guest = fakeTx();
    await new OutboxService(
      clsWith({
        organizationId: ORG,
        guest: {
          sessionId: 's',
          tokenHash: 'h',
          reservationId: 'r',
          reservationRoomId: 'rr',
          guestId: GUEST,
          verified: true,
        },
      }),
    ).enqueue(guest.tx, 'PropertyCreated', payload);
    expect(guest.create.mock.calls[0]![0].data).toMatchObject({
      actorType: 'GUEST',
      actorId: GUEST,
    });
  });

  it('refuses to write an event outside an organization context', async () => {
    const outbox = new OutboxService(clsWith({ identityId: IDENTITY }));
    const { tx, create } = fakeTx();
    await expect(outbox.enqueue(tx, 'PropertyCreated', payload)).rejects.toThrow(
      'Outbox event without organization context',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates the transaction's failure so the caller's change rolls back with it", async () => {
    const outbox = new OutboxService(clsWith({ organizationId: ORG }));
    const { tx, create } = fakeTx();
    create.mockRejectedValueOnce(new Error('connection lost'));
    await expect(outbox.enqueue(tx, 'PropertyCreated', payload)).rejects.toThrow('connection lost');
  });
});
