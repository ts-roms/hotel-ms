import type {
  GuestPortalSettings,
  GuestPortalSettingsInput,
  IdentityDocument,
  IdentityDocumentListQuery,
  IdentityReviewInput,
  StaffGuestMessageInput,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, items, type PropertyTransport } from '../../http.js';

/** Guest portal links and settings, guest ID review, messages to guests. */
export function guestServicesClient({ call, baseUrl, propertyId }: PropertyTransport) {
  return {
    sendGuestPortalLink: (reservationId: string) =>
      op.GuestServiceController_sendLink(call, { propertyId, reservationId }).then(data),
    guestIds: (status: IdentityDocumentListQuery['status'] = 'PENDING') =>
      op
        .GuestIdentityController_listIds<{ items: IdentityDocument[] }>(
          call,
          { propertyId },
          { status },
        )
        .then(items),
    /** Same-origin (the session cookie authenticates); every view is audited. */
    guestIdContentUrl: (documentId: string) =>
      `${baseUrl}${op.paths.GuestIdentityController_idContent({ propertyId, documentId })}`,
    reviewGuestId: (documentId: string, version: number, body: IdentityReviewInput) =>
      op
        .GuestIdentityController_review<IdentityDocument>(call, { propertyId, documentId }, body, {
          ifMatch: `W/"${version}"`,
        })
        .then(data),
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
