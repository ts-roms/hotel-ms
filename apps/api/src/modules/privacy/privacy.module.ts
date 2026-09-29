import { Module } from '@nestjs/common';
import { FnbModule } from '../fnb/fnb.module.js';
import { PmsModule } from '../pms/pms.module.js';
import { GuestImagesController } from './guest-images.controller.js';
import { ImagesController } from './images.controller.js';
import { ImagesService } from './images.service.js';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyService } from './privacy.service.js';

/** Data export/anonymization, CSV imports and hotel images (ADR-0030). */
@Module({
  imports: [PmsModule, FnbModule],
  controllers: [PrivacyController, ImportsController, ImagesController, GuestImagesController],
  providers: [PrivacyService, ImportsService, ImagesService],
})
export class PrivacyModule {}
