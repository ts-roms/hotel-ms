import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PmsModule } from '../pms/pms.module.js';
import { HousekeepingService } from './housekeeping/housekeeping.service.js';
import { LostFoundController } from './lost-found/lost-found.controller.js';
import { LostFoundService } from './lost-found/lost-found.service.js';
import { MaintenanceController } from './maintenance/maintenance.controller.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { ServiceRequestsService } from './service-requests/service-requests.service.js';

/**
 * Operations (blueprint §6.1): housekeeping, maintenance, lost & found and guest service
 * requests. Housekeeping and service-request routes are served by the front-office and
 * guest-portal controllers, which use the services exported here.
 */
@Module({
  imports: [PmsModule, NotificationsModule],
  controllers: [MaintenanceController, LostFoundController],
  providers: [HousekeepingService, MaintenanceService, LostFoundService, ServiceRequestsService],
  exports: [HousekeepingService, ServiceRequestsService],
})
export class OperationsModule {}
