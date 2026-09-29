import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { PmsModule } from '../pms/pms.module.js';
import { FrontOfficeController } from './front-office.controller.js';
import { FrontOfficeService } from './front-office.service.js';
import { NightAuditService } from './night-audit.service.js';

/**
 * Front Office (blueprint §6.1, §12.4-12.5): front desk, check-in/out, night audit and
 * business date. Folio, tax-rule and housekeeping routes are served by their own contexts.
 */
@Module({
  imports: [PmsModule, FinanceModule, OperationsModule, NotificationsModule],
  controllers: [FrontOfficeController],
  providers: [FrontOfficeService, NightAuditService],
  exports: [FrontOfficeService],
})
export class FrontOfficeModule {}
