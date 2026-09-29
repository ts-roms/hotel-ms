import type {
  GuestPortalSettings,
  GuestPortalSettingsInput,
  StaffGuestMessageInput,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, type PropertyTransport } from '../../http.js';

/** The guest portal from the staff side: portal links, settings and messages to guests. */
export function guestPortalClient({ call, propertyId }: PropertyTransport) {
  return {
    sendGuestPortalLink: (reservationId: string) =>
      op.GuestServiceController_sendLink(call, { propertyId, reservationId }).then(data),
    guestPortalSettings: () =>
      op.GuestAdminController_settings<GuestPortalSettings>(call, { propertyId }).then(data),
    updateGuestPortalSettings: (body: GuestPortalSettingsInput) =>
      op
        .GuestAdminController_updateSettings<GuestPortalSettings>(call, { propertyId }, body)
        .then(data),
    messageGuest: (reservationId: string, lineId: string, body: StaffGuestMessageInput) =>
      op.GuestAdminController_message(call, { propertyId, reservationId, lineId }, body).then(data),
  };
}
