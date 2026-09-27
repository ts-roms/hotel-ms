import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type EmailJob, NOTIFICATIONS_QUEUE } from '@hotel/contracts';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../common/request-context.js';
import { ENV, type Env } from '../config/env.js';

/**
 * Producer for the notifications queue (worker delivers). Used for identity-level mail
 * (password reset, invitations) that has no tenant outbox to go through.
 *
 * Jobs can carry single-use links, so they are removed from Redis as soon as they finish.
 */
@Injectable()
export class NotificationsQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<EmailJob>;

  constructor(
    @Inject(ENV) env: Env,
    private readonly cls: ClsService<RequestContext>,
  ) {
    this.connection = new Redis(env.REDIS_QUEUE_URL, { maxRetriesPerRequest: null });
    this.connection.on('error', () => undefined);
    this.queue = new Queue<EmailJob>(NOTIFICATIONS_QUEUE, { connection: this.connection });
  }

  async sendEmail(
    job: Omit<EmailJob, 'correlationId' | 'locale'> & { locale?: string },
  ): Promise<void> {
    const payload = {
      ...job,
      locale: job.locale ?? 'en',
      correlationId: this.cls.isActive() ? (this.cls.get('requestId') ?? null) : null,
    } as EmailJob;
    await this.queue.add(`email:${job.template}`, payload, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
    });
  }

  /** Test helper: inspect queued jobs. */
  get raw(): Queue<EmailJob> {
    return this.queue;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
