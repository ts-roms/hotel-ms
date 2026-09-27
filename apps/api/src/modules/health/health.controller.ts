import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Public } from '../../common/route-metadata.js';
import { PrismaService } from '../../infrastructure/database.js';
import { CacheRedis } from '../../infrastructure/redis.js';

/** Liveness/readiness for the orchestrator. Not exposed through the public load balancer. */
@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: CacheRedis,
  ) {}

  @Get('live')
  @Public()
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const [database, cache] = await Promise.all([
      this.prisma.client.$queryRaw`SELECT 1`.then(
        () => 'ok' as const,
        () => 'error' as const,
      ),
      this.redis.client.ping().then(
        () => 'ok' as const,
        () => 'error' as const,
      ),
    ]);
    // The cache is not required to serve traffic (rate limits fail open), so only the
    // database decides readiness.
    const ready = database === 'ok';
    reply.status(ready ? 200 : 503);
    return { status: ready ? 'ok' : 'error', checks: { database, cache } };
  }
}
