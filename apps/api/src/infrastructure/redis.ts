import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Problems } from '../common/problem.js';
import { ENV, type Env } from '../config/env.js';

/**
 * Redis "A": cache, rate limits, locks. Evicting instance; never a source of truth
 * (ADR-0007). BullMQ uses a separate non-evicting instance.
 */
@Injectable()
export class CacheRedis implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_CACHE_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    // Connection errors are surfaced by callers and /health/ready; avoid crash on emit.
    this.client.on('error', () => undefined);
  }

  /**
   * Cache keys for tenant data MUST include the organization. This helper makes that
   * impossible to forget.
   */
  static tenantKey(organizationId: string, ...parts: string[]): string {
    if (!organizationId) throw new Error('tenantKey requires an organizationId');
    return ['t', organizationId, ...parts].join(':');
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}

@Injectable()
export class RateLimiter {
  constructor(private readonly redis: CacheRedis) {}

  /**
   * Fixed-window counter. Throws 429 when `limit` is exceeded within `windowSeconds`.
   * Fails open if Redis is unavailable: rate limiting is a protection layer, not an
   * availability dependency (account lockout in the DB still applies to logins).
   */
  async consume(key: string, limit: number, windowSeconds: number): Promise<void> {
    let count: number;
    let ttl: number;
    try {
      const fullKey = `rl:${key}`;
      const results = await this.redis.client
        .multi()
        .incr(fullKey)
        .expire(fullKey, windowSeconds, 'NX')
        .ttl(fullKey)
        .exec();
      count = Number(results?.[0]?.[1] ?? 0);
      ttl = Number(results?.[2]?.[1] ?? windowSeconds);
    } catch {
      return;
    }
    if (count > limit) throw Problems.rateLimited(Math.max(ttl, 1));
  }
}
