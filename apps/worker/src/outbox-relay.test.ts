import type { PrismaClient } from '@hotel/database';
import type { Queue } from 'bullmq';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { OUTBOX_MAX_ATTEMPTS, relayOutboxBatch } from './outbox-relay.js';

const log = pino({ level: 'silent' });

interface Row {
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

const row = (n: number, overrides: Partial<Row> = {}): Row => ({
  id: `01900000-0000-7000-8000-00000000000${n}`,
  organization_id: 'org-1',
  property_id: 'prop-1',
  type: 'ReservationCreated',
  version: 1,
  payload: { n },
  actor_type: 'MEMBER',
  actor_id: 'identity-1',
  correlation_id: `req-${n}`,
  occurred_at: new Date(`2026-10-01T00:00:0${n}Z`),
  attempts: 0,
  ...overrides,
});

/**
 * A system client whose transaction serves `rows` to the SELECT and records the UPDATEs.
 * Tagged-template calls arrive as (strings, ...values).
 */
function fakeSystem(rows: Row[]) {
  const selects: { sql: string; values: unknown[] }[] = [];
  const updates: { sql: string; values: unknown[] }[] = [];
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      selects.push({ sql: strings.join('?'), values });
      return rows;
    }),
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      updates.push({ sql: strings.join('?'), values });
      return 1;
    }),
  };
  const $transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>, _options?: unknown) =>
    fn(tx),
  );
  return { system: { $transaction } as unknown as PrismaClient, $transaction, selects, updates };
}

function fakeQueue(add: (name: string, data: unknown, opts: unknown) => Promise<unknown>) {
  const spy = vi.fn(add);
  return { queue: { add: spy } as unknown as Queue, add: spy };
}

describe('relayOutboxBatch', () => {
  it('reads one batch of unpublished, retryable events oldest first, locked for this relay', async () => {
    const { system, $transaction, selects } = fakeSystem([]);
    const { queue, add } = fakeQueue(async () => ({}));

    expect(await relayOutboxBatch(system, queue, log)).toBe(0);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0]![1]).toEqual({ timeout: 30_000 });
    const [select] = selects;
    expect(select!.sql).toMatch(/published_at IS NULL AND attempts < \?/);
    expect(select!.sql).toMatch(/ORDER BY occurred_at\s+LIMIT \?\s+FOR UPDATE SKIP LOCKED/);
    expect(select!.values).toEqual([OUTBOX_MAX_ATTEMPTS, 100]);
    expect(add).not.toHaveBeenCalled();
  });

  it('honours batch size and attempt cap options', async () => {
    const { system, selects } = fakeSystem([]);
    const { queue } = fakeQueue(async () => ({}));
    await relayOutboxBatch(system, queue, log, { batchSize: 5, maxAttempts: 3 });
    expect(selects[0]!.values).toEqual([3, 5]);
  });

  it('publishes each event as an envelope keyed by the event id, then marks it published', async () => {
    const rows = [row(1), row(2, { property_id: null, actor_type: 'SYSTEM', actor_id: null })];
    const { system, updates } = fakeSystem(rows);
    const { queue, add } = fakeQueue(async () => ({}));

    expect(await relayOutboxBatch(system, queue, log)).toBe(2);

    expect(add).toHaveBeenCalledTimes(2);
    const [name, envelope, opts] = add.mock.calls[0]!;
    expect(name).toBe('ReservationCreated');
    expect(envelope).toEqual({
      eventId: rows[0]!.id,
      type: 'ReservationCreated',
      version: 1,
      occurredAt: '2026-10-01T00:00:01.000Z',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      actor: { type: 'MEMBER', id: 'identity-1' },
      correlationId: 'req-1',
      payload: { n: 1 },
    });
    // The job id is the event id: re-publishing after a crash is a no-op in BullMQ.
    expect(opts).toMatchObject({ jobId: rows[0]!.id, attempts: 10, removeOnFail: false });
    expect(add.mock.calls[1]![1]).toMatchObject({
      propertyId: null,
      actor: { type: 'SYSTEM', id: null },
    });

    expect(updates).toHaveLength(2);
    for (const [i, update] of updates.entries()) {
      expect(update.sql).toMatch(/SET published_at = now\(\), attempts = attempts \+ 1/);
      expect(update.values).toEqual([rows[i]!.id]);
    }
  });

  it('counts a failed publish as an attempt with its error, and carries on with the batch', async () => {
    const rows = [row(1), row(2), row(3)];
    const { system, updates } = fakeSystem(rows);
    const { queue } = fakeQueue(async (_name, data) => {
      if ((data as { eventId: string }).eventId === rows[1]!.id) throw new Error('redis down');
      return {};
    });
    const error = vi.spyOn(log, 'error');

    expect(await relayOutboxBatch(system, queue, log)).toBe(2);

    expect(updates.map((u) => u.values.at(-1))).toEqual(rows.map((r) => r.id));
    const failed = updates[1]!;
    expect(failed.sql).not.toMatch(/published_at/);
    expect(failed.sql).toMatch(/SET attempts = attempts \+ 1, last_error = \?/);
    expect(failed.values).toEqual(['redis down', rows[1]!.id]);
    expect(updates[0]!.sql).toMatch(/published_at = now\(\)/);
    expect(updates[2]!.sql).toMatch(/published_at = now\(\)/);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: rows[1]!.id, type: 'ReservationCreated' }),
      'outbox publish failed',
    );
    error.mockRestore();
  });

  it('truncates long errors and records non-Error throwables', async () => {
    const rows = [row(1), row(2)];
    const { system, updates } = fakeSystem(rows);
    const { queue } = fakeQueue(async (_name, data) => {
      if ((data as { eventId: string }).eventId === rows[0]!.id) throw new Error('x'.repeat(5000));
      throw 'plain string failure';
    });

    expect(await relayOutboxBatch(system, queue, log)).toBe(0);
    expect((updates[0]!.values[0] as string).length).toBe(1000);
    expect(updates[1]!.values[0]).toBe('plain string failure');
  });

  it('fails the whole batch (so its transaction rolls back) if an event cannot be marked', async () => {
    const tx = {
      $queryRaw: async () => [row(1)],
      $executeRaw: async () => {
        throw new Error('deadlock');
      },
    };
    const system = {
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as PrismaClient;
    const { queue } = fakeQueue(async () => ({}));
    // Marking it published fails, recording the failure fails too: the error escapes, the
    // transaction rolls back and the event stays unpublished; the job id dedupes the retry.
    await expect(relayOutboxBatch(system, queue, log)).rejects.toThrow('deadlock');
  });
});
