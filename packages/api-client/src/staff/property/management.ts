import type {
  FnbReport,
  GuestServiceReport,
  HrReport,
  OccupancyReport,
  PropertyDashboard,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, qs, type PropertyTransport, type RouteSegment } from '../../http.js';

/**
 * Report kinds with a CSV export route (PropertyReportsController_<kind>Csv), read from the
 * generated route table: "occupancy" | "hr" | "fnb" | "guest-services".
 */
type ReportExportKind = RouteSegment<'GET /properties/{propertyId}/reports/', '/export'>;

/** Management: the property dashboard and operational reports. */
export function managementClient({ call, baseUrl, propertyId }: PropertyTransport) {
  const property = op.paths.PropertiesController_get({ propertyId });
  return {
    dashboard: () =>
      op.PropertyReportsController_dashboard<PropertyDashboard>(call, { propertyId }).then(data),
    occupancyReport: (from: string, to: string) =>
      op
        .PropertyReportsController_occupancy<OccupancyReport>(call, { propertyId }, { from, to })
        .then(data),
    hrReport: (from: string, to: string) =>
      op.PropertyReportsController_hr<HrReport>(call, { propertyId }, { from, to }).then(data),
    fnbReport: (from: string, to: string) =>
      op.PropertyReportsController_fnb<FnbReport>(call, { propertyId }, { from, to }).then(data),
    guestServiceReport: (from: string, to: string) =>
      op
        .PropertyReportsController_guestServices<GuestServiceReport>(
          call,
          { propertyId },
          { from, to },
        )
        .then(data),
    /** CSV download (same-origin; the session cookie authenticates). */
    reportExportUrl: (kind: ReportExportKind, from: string, to: string) =>
      `${baseUrl}${property}/reports/${kind}/export${qs({ from, to })}`,
  };
}
