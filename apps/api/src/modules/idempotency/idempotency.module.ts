import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service.js';

/** Shared kernel (ADR-0009): idempotent writes for every context's controllers. */
@Global()
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
