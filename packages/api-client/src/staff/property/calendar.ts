import type {
  Calendar,
  CreateEventInput,
  HotelEvent,
  StaffRef,
  UpdateEventRequest,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, items, type PropertyTransport } from '../../http.js';

/** Unified calendar and hotel events. */
export function calendarClient({ call, propertyId }: PropertyTransport) {
  return {
    calendar: (from: string, to: string) =>
      op.CalendarController_view<Calendar>(call, { propertyId }, { from, to }).then(data),
    event: (eventId: string) =>
      op.CalendarController_event<HotelEvent>(call, { propertyId, eventId }).then(data),
    eventPeople: () =>
      op.CalendarController_people<{ items: StaffRef[] }>(call, { propertyId }).then(items),
    createEvent: (body: CreateEventInput) =>
      op.CalendarController_create<HotelEvent>(call, { propertyId }, body).then(data),
    updateEvent: (eventId: string, version: number, body: UpdateEventRequest) =>
      op
        .CalendarController_update<HotelEvent>(call, { propertyId, eventId }, body, {
          ifMatch: `W/"${version}"`,
        })
        .then(data),
  };
}
