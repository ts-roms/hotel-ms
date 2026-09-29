import type { AuditLogEntry, AuditLogQuery } from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, type Page, type Transport } from '../http.js';

/** The organization's audit log. */
export function auditClient({ call }: Transport) {
  return {
    auditLogs: {
      list: (params: Partial<AuditLogQuery> = {}) =>
        op.AuditController_list<Page<AuditLogEntry>>(call, params).then(data),
    },
  };
}
