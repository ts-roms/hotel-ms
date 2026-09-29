import type { AnonymizeResult } from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, type Transport } from '../http.js';

/** Data requests (ADR-0030): privacy.manage with two-step verification. */
export function privacyClient({ call, baseUrl }: Transport) {
  return {
    privacy: {
      guestExportUrl: (guestId: string) =>
        `${baseUrl}${op.paths.PrivacyController_exportGuest({ guestId })}`,
      anonymizeGuest: (guestId: string, reason: string) =>
        op
          .PrivacyController_anonymizeGuest<AnonymizeResult>(call, { guestId }, { reason })
          .then(data),
      employeeExportUrl: (employeeId: string) =>
        `${baseUrl}${op.paths.PrivacyController_exportEmployee({ employeeId })}`,
      anonymizeEmployee: (employeeId: string, reason: string) =>
        op
          .PrivacyController_anonymizeEmployee<AnonymizeResult>(call, { employeeId }, { reason })
          .then(data),
    },
  };
}
