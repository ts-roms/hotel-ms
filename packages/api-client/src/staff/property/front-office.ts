import type {
  BusinessDayClosing,
  FrontDesk,
  NightAuditPreview,
  Reservation,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, type PropertyTransport } from '../../http.js';

/** Front desk: arrivals, check-in and check-out, night audit. */
export function frontOfficeClient({ call, propertyId }: PropertyTransport) {
  return {
    frontDesk: () => op.FrontOfficeController_board<FrontDesk>(call, { propertyId }).then(data),
    checkIn: (reservationId: string, lineId: string) =>
      op
        .FrontOfficeController_checkIn<Reservation>(call, { propertyId, reservationId, lineId })
        .then(data),
    checkOut: (reservationId: string, lineId: string) =>
      op
        .FrontOfficeController_checkOut<Reservation>(call, { propertyId, reservationId, lineId })
        .then(data),
    nightAuditPreview: () =>
      op
        .FrontOfficeController_nightAuditPreview<NightAuditPreview>(call, { propertyId })
        .then(data),
    runNightAudit: (businessDate: string) =>
      op
        .FrontOfficeController_runNightAudit<BusinessDayClosing>(
          call,
          { propertyId },
          { businessDate },
        )
        .then(data),
    businessDays: () =>
      op.FrontOfficeController_closings<BusinessDayClosing[]>(call, { propertyId }).then(data),
  };
}
