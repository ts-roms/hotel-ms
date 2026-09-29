import { Module } from '@nestjs/common';
import { OpsController } from './ops.controller.js';
import { OperatorGuard, OpsService } from './ops.service.js';

/** Platform operator tooling (ADR-0029): queue and outbox overview and retries. */
@Module({
  controllers: [OpsController],
  providers: [OpsService, OperatorGuard],
})
export class OpsModule {}
