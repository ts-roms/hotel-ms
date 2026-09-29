import type {
  BusinessDayClosing,
  FrontDesk,
  NightAuditPreview,
  Reservation,
} from '@hotel/contracts';
import type { PropertyTransport } from '../../http.js';

/** Front desk: arrivals, check-in and check-out, night audit. */
export function frontOfficeClient({ call, p, id }: PropertyTransport) {
  return {
    frontDesk: () => call<FrontDesk>('GET', `${p}/front-desk`).then((r) => r.data),
    checkIn: (reservationId: string, lineId: string) =>
      call<Reservation>(
        'POST',
        `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}/check-in`,
      ).then((r) => r.data),
    checkOut: (reservationId: string, lineId: string) =>
      call<Reservation>(
        'POST',
        `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}/check-out`,
      ).then((r) => r.data),
    nightAuditPreview: () => call<NightAuditPreview>('GET', `${p}/night-audit`).then((r) => r.data),
    runNightAudit: (businessDate: string) =>
      call<BusinessDayClosing>('POST', `${p}/night-audit`, { businessDate }).then((r) => r.data),
    businessDays: () => call<BusinessDayClosing[]>('GET', `${p}/business-days`).then((r) => r.data),
  };
}
