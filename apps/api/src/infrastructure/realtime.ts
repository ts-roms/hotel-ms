import { EventEmitter } from 'node:events';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';
import { CacheRedis } from './redis.js';

export interface RealtimeMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Realtime fan-out (blueprint §14: kitchen display). Messages are published to Redis after
 * the change commits, so every API instance receives them; each instance forwards them to
 * its own open streams. Channels always include the organization:
 * `t:{org}:{topic}`. Delivery is best effort: clients refetch on every message and on
 * reconnect, so a lost message costs at most one poll.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly subscriber: Redis;
  private readonly local = new EventEmitter();
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly redis: CacheRedis,
    @Inject(ENV) env: Env,
  ) {
    this.local.setMaxListeners(0);
    this.subscriber = new Redis(env.REDIS_CACHE_URL, { maxRetriesPerRequest: null });
    this.subscriber.on('error', () => undefined);
    this.subscriber.on('message', (channel: string, payload: string) => {
      try {
        this.local.emit(channel, JSON.parse(payload) as RealtimeMessage);
      } catch {
        // Not ours; ignore.
      }
    });
  }

  static channel(organizationId: string, topic: string): string {
    if (!organizationId) throw new Error('Realtime channels require an organization');
    return `t:${organizationId}:${topic}`;
  }

  async publish(channel: string, message: RealtimeMessage): Promise<void> {
    try {
      await this.redis.client.publish(channel, JSON.stringify(message));
    } catch {
      // Best effort: clients also poll.
    }
  }

  /** Returns an unsubscribe function. */
  async subscribe(
    channel: string,
    listener: (message: RealtimeMessage) => void,
  ): Promise<() => void> {
    this.local.on(channel, listener);
    const count = (this.counts.get(channel) ?? 0) + 1;
    this.counts.set(channel, count);
    if (count === 1) await this.subscriber.subscribe(channel).catch(() => undefined);
    return () => {
      this.local.off(channel, listener);
      const left = (this.counts.get(channel) ?? 1) - 1;
      if (left <= 0) {
        this.counts.delete(channel);
        void this.subscriber.unsubscribe(channel).catch(() => undefined);
      } else {
        this.counts.set(channel, left);
      }
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.subscriber.disconnect();
  }
}
