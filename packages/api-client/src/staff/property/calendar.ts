import type {
  Calendar,
  CreateEventInput,
  HotelEvent,
  StaffRef,
  UpdateEventRequest,
} from '@hotel/contracts';
import type { PropertyTransport } from '../../http.js';

/** Unified calendar and hotel events. */
export function calendarClient({ call, qs, p, id }: PropertyTransport) {
  return {
    calendar: (from: string, to: string) =>
      call<Calendar>('GET', `${p}/calendar${qs({ from, to })}`).then((r) => r.data),
    event: (eventId: string) =>
      call<HotelEvent>('GET', `${p}/events/${id(eventId)}`).then((r) => r.data),
    eventPeople: () =>
      call<{ items: StaffRef[] }>('GET', `${p}/events/people`).then((r) => r.data.items),
    createEvent: (body: CreateEventInput) =>
      call<HotelEvent>('POST', `${p}/events`, body).then((r) => r.data),
    updateEvent: (eventId: string, version: number, body: UpdateEventRequest) =>
      call<HotelEvent>('PATCH', `${p}/events/${id(eventId)}`, body, {
        'if-match': `W/"${version}"`,
      }).then((r) => r.data),
  };
}
