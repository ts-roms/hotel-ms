import type { OpsOverview } from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, type Transport } from '../http.js';

/** Platform operators only (ADR-0029). */
export function opsClient({ call }: Transport) {
  return {
    /** Platform operators only (ADR-0029). */
    ops: {
      overview: () => op.OpsController_overview<OpsOverview>(call).then(data),
      retryJob: (queue: string, jobId: string) =>
        op.OpsController_retryJob(call, { queue, jobId }).then(data),
      retryOutbox: (eventId: string) =>
        op.OpsController_retryOutbox<void>(call, { eventId }).then(data),
    },
  };
}
