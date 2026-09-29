import type { GuestPortalSettings, GuestPortalSettingsInput } from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, type PropertyTransport } from '../../http.js';

/** The guest portal from the staff side: portal links and settings. */
export function guestPortalClient({ call, propertyId }: PropertyTransport) {
  return {
    sendGuestPortalLink: (reservationId: string) =>
      op.GuestPortalLinkController_sendLink(call, { propertyId, reservationId }).then(data),
    guestPortalSettings: () =>
      op.GuestAdminController_settings<GuestPortalSettings>(call, { propertyId }).then(data),
    updateGuestPortalSettings: (body: GuestPortalSettingsInput) =>
      op
        .GuestAdminController_updateSettings<GuestPortalSettings>(call, { propertyId }, body)
        .then(data),
  };
}
