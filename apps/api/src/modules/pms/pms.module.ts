import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { GuestIdentityController } from './guests/guest-identity.controller.js';
import { GuestIdentityService } from './guests/guest-identity.service.js';
import { GuestsController } from './guests/guests.controller.js';
import { GuestsService } from './guests/guests.service.js';
import { InventoryController } from './inventory/inventory.controller.js';
import { RoomTypesService } from './inventory/room-types.service.js';
import { RoomsService } from './inventory/rooms.service.js';
import { PricingController } from './pricing/pricing.controller.js';
import { RatesService } from './pricing/rates.service.js';
import { TaxRulesController } from './pricing/tax-rules.controller.js';
import { TaxRulesService } from './pricing/tax-rules.service.js';
import { ReservationsController } from './reservations/reservations.controller.js';
import { ReservationsService } from './reservations/reservations.service.js';

/**
 * PMS core (blueprint §6.1, §12): Inventory (inventory/), Pricing incl. tax rules
 * (pricing/), Reservations (reservations/) and Guests incl. guest ID documents (guests/).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [
    InventoryController,
    PricingController,
    TaxRulesController,
    ReservationsController,
    GuestsController,
    GuestIdentityController,
  ],
  providers: [
    RoomsService,
    RoomTypesService,
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
