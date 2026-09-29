import type {
  FnbReport,
  GuestServiceReport,
  HrReport,
  OccupancyReport,
  PropertyDashboard,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, qs, type PropertyTransport, type RouteSegment } from '../../http.js';

/** Report kinds with a CSV export route (PropertyReportsController_<kind>Csv). */
type ExportKind = 'occupancy' | 'hr' | 'fnb' | 'guest-services';
/** Fails to type-check if the API drops the export route of any ExportKind. */
type Exported = RouteSegment<'GET /properties/{propertyId}/reports/', '/export'>;

/** Property dashboard and operational reports. */
export function insightsClient({ call, baseUrl, propertyId }: PropertyTransport) {
  const exportPath = (kind: Exported) =>
    `${op.paths.PropertiesController_get({ propertyId })}/reports/${kind}/export`;
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
    reportExportUrl: (kind: ExportKind, from: string, to: string) =>
      `${baseUrl}${exportPath(kind)}${qs({ from, to })}`,
  };
}
