import type { AnonymizeResult } from '@hotel/contracts';
import type { Transport } from '../http.js';

/** Data requests (ADR-0030): privacy.manage with two-step verification. */
export function privacyClient({ call, baseUrl }: Transport) {
  return {
    privacy: {
      guestExportUrl: (guestId: string) =>
        `${baseUrl}/guests/${encodeURIComponent(guestId)}/export`,
      anonymizeGuest: (guestId: string, reason: string) =>
        call<AnonymizeResult>('POST', `/guests/${encodeURIComponent(guestId)}/anonymize`, {
          reason,
        }).then((r) => r.data),
      employeeExportUrl: (employeeId: string) =>
        `${baseUrl}/employees/${encodeURIComponent(employeeId)}/export`,
      anonymizeEmployee: (employeeId: string, reason: string) =>
        call<AnonymizeResult>('POST', `/employees/${encodeURIComponent(employeeId)}/anonymize`, {
          reason,
        }).then((r) => r.data),
    },
  };
}
