import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PmsModule } from '../pms/pms.module.js';
import { HousekeepingController } from './housekeeping/housekeeping.controller.js';
import { HousekeepingService } from './housekeeping/housekeeping.service.js';
import { LostFoundController } from './lost-found/lost-found.controller.js';
import { LostFoundService } from './lost-found/lost-found.service.js';
import { MaintenanceController } from './maintenance/maintenance.controller.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { ServiceRequestsController } from './service-requests/service-requests.controller.js';
import { ServiceRequestsService } from './service-requests/service-requests.service.js';

/**
 * Operations (blueprint §6.1): housekeeping, maintenance, lost & found and guest service
 * requests. Front Office and the guest portal use the exported services.
 */
@Module({
  imports: [PmsModule, NotificationsModule],
  controllers: [
    HousekeepingController,
    ServiceRequestsController,
    MaintenanceController,
    LostFoundController,
  ],
  providers: [HousekeepingService, MaintenanceService, LostFoundService, ServiceRequestsService],
  exports: [HousekeepingService, ServiceRequestsService],
})
export class OperationsModule {}
