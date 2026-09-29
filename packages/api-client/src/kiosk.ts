import type { ClockPunchResult, KioskState, PunchType } from '@hotel/contracts';
import { type ApiClientOptions, createCaller } from './http.js';

/** A shared device's own endpoints (ADR-0020); its cookies authenticate it. */
export function createKioskApiClient(options: ApiClientOptions = {}) {
  const { call } = createCaller(options);
  const data = <T>(r: { data: T }) => r.data;
  return {
    state: () => call<KioskState>('GET', '/kiosk').then(data),
    pair: (code: string) => call<KioskState>('POST', '/kiosk/pair', { code }).then(data),
    signIn: (membershipId: string, pin: string) =>
      call<KioskState>('POST', '/kiosk/sign-in', { membershipId, pin }).then(data),
    signOut: () => call<KioskState>('POST', '/kiosk/sign-out').then(data),
    /** Time clock punch: the selfie (a JPEG blob) is the body. */
    clock: (employeeNo: string, type: PunchType, selfie: Blob) =>
      call<ClockPunchResult>(
        'POST',
        `/kiosk/clock?${new URLSearchParams({ employeeNo, type })}`,
        selfie,
      ).then(data),
  };
}
