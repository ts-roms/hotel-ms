import type { CreateDeviceRequest, Device, DevicePairing } from '@hotel/contracts';
import type { PropertyTransport } from '../../http.js';

/** Shared devices (kitchen tablets, time clocks). */
export function devicesClient({ call, p, id }: PropertyTransport) {
  return {
    devices: () => call<{ items: Device[] }>('GET', `${p}/devices`).then((r) => r.data.items),
    createDevice: (body: CreateDeviceRequest) =>
      call<DevicePairing>('POST', `${p}/devices`, body).then((r) => r.data),
    repairDevice: (deviceId: string) =>
      call<DevicePairing>('POST', `${p}/devices/${id(deviceId)}/pairing`).then((r) => r.data),
    revokeDevice: (deviceId: string) =>
      call<Device>('POST', `${p}/devices/${id(deviceId)}/revoke`).then((r) => r.data),
  };
}
