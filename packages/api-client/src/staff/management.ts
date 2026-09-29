import type { OrganizationDashboard, SearchResult } from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, items, type Transport } from '../http.js';

/** Management: the group overview (ADR-0025) and search across properties. */
export function managementClient({ call }: Transport) {
  return {
    /** Group overview (ADR-0025). */
    dashboard: () => op.ManagementController_organization<OrganizationDashboard>(call).then(data),
    search: (q: string) => op.ManagementController_search<SearchResult>(call, { q }).then(items),
  };
}
