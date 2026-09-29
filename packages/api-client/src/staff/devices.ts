import type { PinStatus } from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, type Transport } from '../http.js';

/** The signed-in staff member's shared-device PIN (ADR-0020; part of the `me` group). */
export function devicesClient({ call }: Transport) {
  return {
    me: {
      pin: () => op.PinController_status<PinStatus>(call).then(data),
      setPin: (pin: string, currentPassword: string) =>
        op.PinController_set<PinStatus>(call, { pin, currentPassword }).then(data),
      removePin: () => op.PinController_remove<PinStatus>(call).then(data),
    },
  };
}
