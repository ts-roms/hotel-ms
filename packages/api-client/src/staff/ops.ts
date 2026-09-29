import type { OpsOverview } from '@hotel/contracts';
import type { Transport } from '../http.js';

/** Platform operators only (ADR-0029). */
export function opsClient({ call }: Transport) {
  return {
    /** Platform operators only (ADR-0029). */
    ops: {
      overview: () => call<OpsOverview>('GET', '/ops/overview').then((r) => r.data),
      retryJob: (queue: string, jobId: string) =>
        call<void>(
          'POST',
          `/ops/queues/${encodeURIComponent(queue)}/jobs/${encodeURIComponent(jobId)}/retry`,
        ).then((r) => r.data),
      retryOutbox: (eventId: string) =>
        call<void>('POST', `/ops/outbox/${encodeURIComponent(eventId)}/retry`).then((r) => r.data),
    },
  };
}
