import type {
  CreateGuestRequest,
  Guest,
  IdentityDocument,
  IdentityDocumentListQuery,
  IdentityReviewInput,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, items, type PropertyTransport } from '../../http.js';

/** PMS guests: new guest profiles and the review of uploaded guest IDs. */
export function guestsClient({ call, baseUrl, propertyId }: PropertyTransport) {
  return {
    createGuest: (body: CreateGuestRequest) =>
      op.GuestsController_create<Guest>(call, { propertyId }, body).then(data),
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
  };
}
