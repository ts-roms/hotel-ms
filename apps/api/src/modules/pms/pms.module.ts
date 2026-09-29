import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { GuestIdentityService } from './guests/guest-identity.service.js';
import { GuestsController } from './guests/guests.controller.js';
import { GuestsService } from './guests/guests.service.js';
import { InventoryController } from './inventory/inventory.controller.js';
import { RoomsService } from './inventory/rooms.service.js';
import { RatesService } from './pricing/rates.service.js';
import { TaxRulesService } from './pricing/tax-rules.service.js';
import { ReservationsController } from './reservations/reservations.controller.js';
import { ReservationsService } from './reservations/reservations.service.js';

/**
 * PMS core (blueprint §6.1, §12): Inventory (inventory/), Pricing incl. tax rules
 * (pricing/), Reservations (reservations/) and Guests incl. guest ID documents (guests/).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [InventoryController, ReservationsController, GuestsController],
  providers: [
    RoomsService,
    RatesService,
    TaxRulesService,
    GuestsService,
    ReservationsService,
    GuestIdentityService,
  ],
  exports: [
    RoomsService,
    TaxRulesService,
    GuestsService,
    ReservationsService,
    GuestIdentityService,
  ],
})
export class PmsModule {}
