import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  OPS_COMMANDS_QUEUE,
  OPS_QUEUES,
  OPS_SNAPSHOT_KEY,
  type OpsCommand,
  type OpsOverview,
  type OpsQueue,
  opsSnapshotSchema,
} from '@hotel/contracts';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../../infrastructure/database.js';

/**
 * Platform operators only (ADR-0029): an identity with platform_role OPERATOR, signed in
 * with two-step verification. Everyone else gets a 404, as if the dashboard did not exist.
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    const identityId = this.cls.get('identityId');
    if (!identityId || this.cls.get('mfaVerified') !== true) throw Problems.notFound('Page');
    const identity = await this.prisma.platform.identity.findUnique({
      where: { id: identityId },
      select: { platformRole: true, status: true },
    });
    if (identity?.platformRole !== 'OPERATOR' || identity.status !== 'ACTIVE')
      throw Problems.notFound('Page');
    return true;
  }
}

/**
 * Serves the worker's ops snapshot and forwards operator actions: retrying a failed queue
 * job directly, and a stuck outbox event through the worker (which holds the system role).
 * Every action is written to the request log (platform actions have no tenant audit log).
 */
@Injectable()
export class OpsService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly commands: Queue<OpsCommand>;

  constructor(
    @Inject(ENV) env: Env,
    private readonly cls: ClsService<RequestContext>,
  ) {
    this.connection = new Redis(env.REDIS_QUEUE_URL, { maxRetriesPerRequest: null });
    this.connection.on('error', () => undefined);
    this.commands = new Queue<OpsCommand>(OPS_COMMANDS_QUEUE, { connection: this.connection });
  }

  async onModuleDestroy(): Promise<void> {
    await this.commands.close();
    this.connection.disconnect();
  }

  async overview(): Promise<OpsOverview> {
    const raw = await this.connection.get(OPS_SNAPSHOT_KEY);
    if (!raw) return { snapshot: null };
    const parsed = opsSnapshotSchema.safeParse(JSON.parse(raw));
    return { snapshot: parsed.success ? parsed.data : null };
  }

  private get operator(): string {
    return this.cls.get('identityId')!;
  }

  private logAction(action: string, target: string): void {
    this.cls.get('log')?.info({ operatorId: this.operator, action, target }, 'ops action');
  }

  async retryJob(queueName: string, jobId: string): Promise<void> {
    if (!(OPS_QUEUES as readonly string[]).includes(queueName)) throw Problems.notFound('Queue');
    const queue = new Queue(queueName as OpsQueue, { connection: this.connection });
    try {
      const job = await queue.getJob(jobId);
      if (!job || !(await job.isFailed())) throw Problems.notFound('Failed job');
      await job.retry('failed');
    } finally {
      await queue.close();
    }
    this.logAction('ops.job_retried', `${queueName}:${jobId}`);
  }

  async retryOutboxEvent(eventId: string): Promise<void> {
    await this.commands.add(
      'outbox.retry',
      { type: 'outbox.retry', eventId, requestedBy: this.operator },
      { attempts: 3, removeOnComplete: 100, removeOnFail: 100 },
    );
    this.logAction('ops.outbox_retried', eventId);
  }
}
