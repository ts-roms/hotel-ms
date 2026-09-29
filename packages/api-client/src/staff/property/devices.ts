import type { CreateDeviceRequest, Device, DevicePairing } from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, items, type PropertyTransport } from '../../http.js';

/** Shared devices (kitchen tablets, time clocks). */
export function devicesClient({ call, propertyId }: PropertyTransport) {
  return {
    devices: () => op.DevicesController_list<{ items: Device[] }>(call, { propertyId }).then(items),
    createDevice: (body: CreateDeviceRequest) =>
      op.DevicesController_create<DevicePairing>(call, { propertyId }, body).then(data),
    repairDevice: (deviceId: string) =>
      op.DevicesController_repair<DevicePairing>(call, { propertyId, deviceId }).then(data),
    revokeDevice: (deviceId: string) =>
      op.DevicesController_revoke<Device>(call, { propertyId, deviceId }).then(data),
  };
}
