import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { FrontOfficeModule } from '../front-office/front-office.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { PmsModule } from '../pms/pms.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { GuestAdminController } from './guest-admin.controller.js';
import { GuestExtrasController } from './guest-extras.controller.js';
import { GuestAccessService } from './guest-access.service.js';
import { GuestInfoService } from './guest-info.service.js';
import { GuestPortalLinkController } from './guest-portal-link.controller.js';
import { GuestPortalController } from './guest-portal.controller.js';
import { GuestPortalService } from './guest-portal.service.js';
import { GuestSessions } from './guest-session.js';
import { FrontDeskKeyProvider, ROOM_ACCESS_PROVIDER } from './room-access.js';

/**
 * Guest Experience (blueprint §6.1, §11): the guest session and guard, stay, pre-check-in,
 * self check-in, room access and hotel info. An orchestrator: it calls Reservations,
 * Front Office, Operations and Messaging through their exported services. GuestGuard is
 * registered globally by AppModule.
 */
@Module({
  imports: [
    TenancyModule,
    PmsModule,
    FinanceModule,
    FrontOfficeModule,
    OperationsModule,
    NotificationsModule,
  ],
  controllers: [
    GuestPortalLinkController,
    GuestExtrasController,
    GuestAdminController,
    GuestPortalController,
  ],
  providers: [
    GuestSessions,
    GuestPortalService,
    GuestAccessService,
    GuestInfoService,
    { provide: ROOM_ACCESS_PROVIDER, useClass: FrontDeskKeyProvider },
  ],
  exports: [GuestSessions, GuestPortalService, GuestAccessService],
})
export class GuestPortalModule {}
