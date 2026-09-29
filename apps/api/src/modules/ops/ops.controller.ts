import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { opsOverviewSchema } from '@hotel/contracts';
import { uuidParam } from '../../common/params.js';
import { NoOrganization } from '../../common/route-metadata.js';
import { ZodResponse } from '../../common/zod.js';
import { OperatorGuard, OpsService } from './ops.service.js';

/** Operations dashboard for platform operators (ADR-0029). Outside any organization. */
@ApiTags('ops')
@Controller('ops')
@NoOrganization()
@UseGuards(OperatorGuard)
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('overview')
  @ZodResponse(200, opsOverviewSchema)
  overview() {
    return this.ops.overview();
  }

  @Post('queues/:queue/jobs/:jobId/retry')
  @HttpCode(204)
  async retryJob(@Param('queue') queue: string, @Param('jobId') jobId: string): Promise<void> {
    await this.ops.retryJob(queue, jobId.slice(0, 100));
  }

  @Post('outbox/:eventId/retry')
  @HttpCode(202)
  async retryOutbox(@Param('eventId') eventId: string): Promise<void> {
    await this.ops.retryOutboxEvent(uuidParam(eventId));
  }
}
