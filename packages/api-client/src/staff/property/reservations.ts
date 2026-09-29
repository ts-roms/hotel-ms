import type {
  AssignRoomRequest,
  CreateReservationRequest,
  Reservation,
  ReservationListQuery,
  UpdateReservationRoomRequest,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, type Page, type PropertyTransport } from '../../http.js';

/** Reservations and their room lines. */
export function reservationsClient({ call, propertyId }: PropertyTransport) {
  return {
    reservations: (params: Partial<ReservationListQuery> = {}) =>
      op.ReservationsController_list<Page<Reservation>>(call, { propertyId }, params).then(data),
    reservation: (reservationId: string) =>
      op.ReservationsController_get<Reservation>(call, { propertyId, reservationId }).then(data),
    createReservation: (body: CreateReservationRequest, idempotencyKey: string) =>
      op
        .ReservationsController_create<Reservation>(call, { propertyId }, body, { idempotencyKey })
        .then(data),
    updateReservationRoom: (
      reservationId: string,
      lineId: string,
      version: number,
      body: UpdateReservationRoomRequest,
    ) =>
      op
        .ReservationsController_updateLine<Reservation>(
          call,
          { propertyId, reservationId, lineId },
          body,
          { ifMatch: `W/"${version}"` },
        )
        .then(data),
    assignRoom: (reservationId: string, lineId: string, body: AssignRoomRequest) =>
      op
        .ReservationsController_assign<Reservation>(
          call,
          { propertyId, reservationId, lineId },
          body,
        )
        .then(data),
    unassignRoom: (reservationId: string, lineId: string) =>
      op
        .ReservationsController_unassign<Reservation>(call, { propertyId, reservationId, lineId })
        .then(data),
    cancelReservation: (reservationId: string, reason: string) =>
      op
        .ReservationsController_cancel<Reservation>(call, { propertyId, reservationId }, { reason })
        .then(data),
    cancelReservationRoom: (reservationId: string, lineId: string, reason: string) =>
      op
        .ReservationsController_cancelLine<Reservation>(
          call,
          { propertyId, reservationId, lineId },
          { reason },
        )
        .then(data),
  };
}
