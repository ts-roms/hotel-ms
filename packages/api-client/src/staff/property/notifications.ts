import type { StaffGuestMessageInput } from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, type PropertyTransport } from '../../http.js';

/** Messaging from a property: staff messages to a guest's in-app inbox. */
export function notificationsClient({ call, propertyId }: PropertyTransport) {
  return {
    messageGuest: (reservationId: string, lineId: string, body: StaffGuestMessageInput) =>
      op.GuestInboxController_message(call, { propertyId, reservationId, lineId }, body).then(data),
  };
}
