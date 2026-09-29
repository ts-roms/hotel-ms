import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HrModule } from '../hr/hr.module.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';
import { KioskController } from './kiosk.controller.js';
import { PinController } from './pin.controller.js';

/** Shared devices and staff PINs (ADR-0020): pairing, kiosk sign-in and the kiosk clock. */
@Module({
  imports: [AuthModule, HrModule],
  controllers: [DevicesController, PinController, KioskController],
  providers: [DevicesService],
})
export class DevicesModule {}
