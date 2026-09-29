import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/** Shared kernel (blueprint §6.1, §20.2): every context records audit entries. */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
