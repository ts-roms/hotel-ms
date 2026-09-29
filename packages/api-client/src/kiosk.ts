import type { ClockPunchResult, KioskState, PunchType } from '@hotel/contracts';
import * as op from './generated/operations.js';
import { type ApiClientOptions, createCaller, data } from './http.js';

/** A shared device's own endpoints (ADR-0020); its cookies authenticate it. */
export function createKioskApiClient(options: ApiClientOptions = {}) {
  const { call } = createCaller(options);
  return {
    state: () => op.KioskController_state<KioskState>(call).then(data),
    pair: (code: string) => op.KioskController_pair<KioskState>(call, { code }).then(data),
    signIn: (membershipId: string, pin: string) =>
      op.KioskController_signIn<KioskState>(call, { membershipId, pin }).then(data),
    signOut: () => op.KioskController_signOut<KioskState>(call).then(data),
    /** Time clock punch: the selfie (a JPEG blob) is the body. */
    clock: (employeeNo: string, type: PunchType, selfie: Blob) =>
      op.KioskController_clock<ClockPunchResult>(call, { employeeNo, type }, selfie).then(data),
  };
}
