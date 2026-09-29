import type {
  GuestPortalSettings,
  GuestPortalSettingsInput,
  IdentityDocument,
  IdentityDocumentListQuery,
  IdentityReviewInput,
  StaffGuestMessageInput,
} from '@hotel/contracts';
import type { PropertyTransport } from '../../http.js';

/** Guest portal links and settings, guest ID review, messages to guests. */
export function guestServicesClient({ call, qs, baseUrl, p, id }: PropertyTransport) {
  return {
    sendGuestPortalLink: (reservationId: string) =>
      call<void>('POST', `${p}/reservations/${id(reservationId)}/guest-portal-link`).then(
        (r) => r.data,
      ),
    guestIds: (status: IdentityDocumentListQuery['status'] = 'PENDING') =>
      call<{ items: IdentityDocument[] }>('GET', `${p}/guest-ids${qs({ status })}`).then(
        (r) => r.data.items,
      ),
    /** Same-origin (the session cookie authenticates); every view is audited. */
    guestIdContentUrl: (documentId: string) => `${baseUrl}${p}/guest-ids/${id(documentId)}/content`,
    reviewGuestId: (documentId: string, version: number, body: IdentityReviewInput) =>
      call<IdentityDocument>('POST', `${p}/guest-ids/${id(documentId)}/review`, body, {
        'if-match': `W/"${version}"`,
      }).then((r) => r.data),
    guestPortalSettings: () =>
      call<GuestPortalSettings>('GET', `${p}/guest-portal-settings`).then((r) => r.data),
    updateGuestPortalSettings: (body: GuestPortalSettingsInput) =>
      call<GuestPortalSettings>('PUT', `${p}/guest-portal-settings`, body).then((r) => r.data),
    messageGuest: (reservationId: string, lineId: string, body: StaffGuestMessageInput) =>
      call<void>(
        'POST',
        `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}/guest-message`,
        body,
      ).then((r) => r.data),
  };
}
