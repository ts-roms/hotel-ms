import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';

/** Shared kernel (blueprint §6.1, §17): every context writes domain events to the outbox. */
@Global()
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
