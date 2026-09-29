import type {
  FnbReport,
  GuestServiceReport,
  HrReport,
  OccupancyReport,
  PropertyDashboard,
} from '@hotel/contracts';
import type { PropertyTransport } from '../../http.js';

/** Property dashboard and operational reports. */
export function insightsClient({ call, qs, baseUrl, p }: PropertyTransport) {
  return {
    dashboard: () => call<PropertyDashboard>('GET', `${p}/dashboard`).then((r) => r.data),
    occupancyReport: (from: string, to: string) =>
      call<OccupancyReport>('GET', `${p}/reports/occupancy${qs({ from, to })}`).then((r) => r.data),
    hrReport: (from: string, to: string) =>
      call<HrReport>('GET', `${p}/reports/hr${qs({ from, to })}`).then((r) => r.data),
    fnbReport: (from: string, to: string) =>
      call<FnbReport>('GET', `${p}/reports/fnb${qs({ from, to })}`).then((r) => r.data),
    guestServiceReport: (from: string, to: string) =>
      call<GuestServiceReport>('GET', `${p}/reports/guest-services${qs({ from, to })}`).then(
        (r) => r.data,
      ),
    /** CSV download (same-origin; the session cookie authenticates). */
    reportExportUrl: (
      kind: 'occupancy' | 'hr' | 'fnb' | 'guest-services',
      from: string,
      to: string,
    ) => `${baseUrl}${p}/reports/${kind}/export${qs({ from, to })}`,
  };
}
