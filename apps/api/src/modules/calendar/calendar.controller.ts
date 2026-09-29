import { Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CalendarQuery,
  calendarQuerySchema,
  calendarSchema,
  type CreateEventRequest,
  createEventRequestSchema,
  hotelEventSchema,
  type UpdateEventRequest,
  updateEventRequestSchema,
  staffRefSchema,
  listOf,
} from '@hotel/contracts';
import { parseIfMatch } from '../../common/etag.js';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { CalendarService } from './calendar.service.js';

/** Events and the unified calendar of a property (ADR-0026). */
@ApiTags('calendar')
@Controller('properties/:propertyId')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('calendar')
  @RequirePermission('property.read')
  @ZodResponse(200, calendarSchema)
  view(
    @Param('propertyId') propertyId: string,
    @ZodQuery(calendarQuerySchema) query: CalendarQuery,
  ) {
    return this.calendar.calendar(propertyId, query.from, query.to);
  }

  /** The staff who can be invited (declared before :eventId). */
  @Get('events/people')
  @RequirePermission('event.manage')
  @ZodResponse(200, listOf(staffRefSchema))
  async people() {
    return { items: await this.calendar.people() };
  }

  @Get('events/:eventId')
  @RequirePermission('event.read')
  @ZodResponse(200, hotelEventSchema)
  event(@Param('eventId') eventId: string) {
    return this.calendar.event(uuidParam(eventId));
  }

  @Post('events')
  @RequirePermission('event.manage')
  @ZodResponse(201, hotelEventSchema)
  create(@ZodBody(createEventRequestSchema) body: CreateEventRequest) {
    return this.calendar.create(body);
  }

  /** Change or cancel (status CANCELLED), with If-Match. */
  @Patch('events/:eventId')
  @RequirePermission('event.manage')
  @ZodResponse(200, hotelEventSchema)
  update(
    @Param('eventId') eventId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateEventRequestSchema) body: UpdateEventRequest,
  ) {
    return this.calendar.update(uuidParam(eventId), parseIfMatch(ifMatch), body);
  }
}
