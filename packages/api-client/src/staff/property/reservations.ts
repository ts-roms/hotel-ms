import type {
  AssignRoomRequest,
  CreateGuestRequest,
  CreateReservationRequest,
  Guest,
  Reservation,
  UpdateReservationRoomRequest,
} from '@hotel/contracts';
import type { Page, PropertyTransport } from '../../http.js';

/** Reservations, their room lines and new guest profiles. */
export function reservationsClient({ call, qs, p, id }: PropertyTransport) {
  return {
    createGuest: (body: CreateGuestRequest) =>
      call<Guest>('POST', `${p}/guests`, body).then((r) => r.data),
    reservations: (
      params: {
        q?: string;
        arrivalFrom?: string;
        arrivalTo?: string;
        status?: string;
        cursor?: string;
        limit?: number;
      } = {},
    ) => call<Page<Reservation>>('GET', `${p}/reservations${qs(params)}`).then((r) => r.data),
    reservation: (reservationId: string) =>
      call<Reservation>('GET', `${p}/reservations/${id(reservationId)}`).then((r) => r.data),
    createReservation: (body: CreateReservationRequest, idempotencyKey: string) =>
      call<Reservation>('POST', `${p}/reservations`, body, {
        'idempotency-key': idempotencyKey,
      }).then((r) => r.data),
    updateReservationRoom: (
      reservationId: string,
      lineId: string,
      version: number,
      body: UpdateReservationRoomRequest,
    ) =>
      call<Reservation>(
        'PATCH',
        `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}`,
        body,
        {
          'if-match': `W/"${version}"`,
        },
      ).then((r) => r.data),
    assignRoom: (reservationId: string, lineId: string, body: AssignRoomRequest) =>
      call<Reservation>(
        'PUT',
        `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}/assignment`,
        body,
      ).then((r) => r.data),
    unassignRoom: (reservationId: string, lineId: string) =>
      call<Reservation>(
        'DELETE',
        `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}/assignment`,
      ).then((r) => r.data),
    cancelReservation: (reservationId: string, reason: string) =>
      call<Reservation>('POST', `${p}/reservations/${id(reservationId)}/cancel`, {
        reason,
      }).then((r) => r.data),
    cancelReservationRoom: (reservationId: string, lineId: string, reason: string) =>
      call<Reservation>(
        'POST',
        `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}/cancel`,
        { reason },
      ).then((r) => r.data),
  };
}
