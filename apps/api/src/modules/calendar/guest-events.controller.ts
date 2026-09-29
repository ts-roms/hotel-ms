import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { guestEventSchema, listOf } from '@hotel/contracts';
import { GuestRoute } from '../../common/route-metadata.js';
import { ZodResponse } from '../../common/zod.js';
import { CalendarService } from './calendar.service.js';

/** Guest portal: the hotel's upcoming events for guests. */
@ApiTags('guest portal')
@Controller('guest')
@GuestRoute({ verified: false })
export class GuestEventsController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('events')
  @ZodResponse(200, listOf(guestEventSchema))
  async list() {
    return { items: await this.calendar.guestEvents() };
  }
}
