import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PmsModule } from '../pms/pms.module.js';
import { FnbController } from './fnb.controller.js';
import { GuestFnbController } from './guest-fnb.controller.js';
import { MenuService } from './menu.service.js';
import { OrdersService } from './orders.service.js';

/** F&B (blueprint §6.1, §14): outlets, menus, orders and room-service delivery. */
@Module({
  imports: [PmsModule, FinanceModule, NotificationsModule],
  controllers: [FnbController, GuestFnbController],
  providers: [MenuService, OrdersService],
})
export class FnbModule {}
