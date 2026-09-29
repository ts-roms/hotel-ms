import { Module } from '@nestjs/common';
import { FrontOfficeModule } from '../front-office/front-office.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { PmsModule } from '../pms/pms.module.js';
import { GuestAdminController } from './guest-admin.controller.js';
import { GuestExtrasController } from './guest-extras.controller.js';
import { GuestInfoService } from './guest-info.service.js';
import { GuestPortalController } from './guest-portal.controller.js';
import { GuestPortalService } from './guest-portal.service.js';
import { GuestServiceController } from './guest-service.controller.js';
import { GuestSessions } from './guest-session.js';
import { FrontDeskKeyProvider, ROOM_ACCESS_PROVIDER } from './room-access.js';

/**
 * Guest Experience (blueprint §6.1, §11): the guest session and guard, stay, pre-check-in,
 * self check-in, room access and hotel info. An orchestrator: it calls Reservations,
 * Front Office, Operations and Messaging through their exported services. GuestGuard is
 * registered globally by AppModule.
 */
@Module({
  imports: [PmsModule, FrontOfficeModule, OperationsModule, NotificationsModule],
  controllers: [
    GuestServiceController,
    GuestExtrasController,
    GuestAdminController,
    GuestPortalController,
  ],
  providers: [
    GuestSessions,
    GuestPortalService,
    GuestInfoService,
    { provide: ROOM_ACCESS_PROVIDER, useClass: FrontDeskKeyProvider },
  ],
  exports: [GuestSessions, GuestPortalService],
})
export class GuestPortalModule {}
