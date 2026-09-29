import { type DynamicModule, Global, Module } from '@nestjs/common';
import { IdempotencyService } from './common/idempotency.js';
import { ENV, type Env } from './config/env.js';
import { PrismaService, TenantDb } from './infrastructure/database.js';
import { NotificationsQueue } from './infrastructure/queue.js';
import { RealtimeService } from './infrastructure/realtime.js';
import { CacheRedis, RateLimiter } from './infrastructure/redis.js';
import { SecretBox, SECRET_BOX } from './infrastructure/secret-box.js';
import { createObjectStorage, OBJECT_STORAGE } from './infrastructure/storage.js';

/**
 * Shared kernel available to every context module without importing it: configuration,
 * database (TenantDb), Redis, queues, realtime, secrets, object storage and idempotency.
 * Context modules never re-provide these.
 */
@Global()
@Module({})
export class CoreModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: SECRET_BOX, useValue: new SecretBox(env.DATA_ENCRYPTION_KEYS) },
        { provide: OBJECT_STORAGE, useValue: createObjectStorage(env) },
        PrismaService,
        TenantDb,
        CacheRedis,
        RateLimiter,
        NotificationsQueue,
        RealtimeService,
        IdempotencyService,
      ],
      exports: [
        ENV,
        SECRET_BOX,
        OBJECT_STORAGE,
        PrismaService,
        TenantDb,
        CacheRedis,
        RateLimiter,
        NotificationsQueue,
        RealtimeService,
        IdempotencyService,
      ],
    };
  }
}
