import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { GuestPortalModule } from '../guest-portal/guest-portal.module.js';
import { HrModule } from '../hr/hr.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PmsModule } from '../pms/pms.module.js';
import { RemindersService } from './reminders.service.js';
import { TenantJobsProcessor } from './tenant-jobs.processor.js';

/** Scheduled per-tenant jobs (ADR-0017): they call other contexts' exported services. */
@Module({
  imports: [NotificationsModule, PmsModule, FinanceModule, HrModule, GuestPortalModule],
  providers: [RemindersService, TenantJobsProcessor],
})
export class JobsModule {}
