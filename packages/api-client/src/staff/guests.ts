import type { Guest } from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, type Transport } from '../http.js';

/** PMS guests across the organization's properties. */
export function guestsClient({ call }: Transport) {
  return {
    guests: {
      search: (q: string, limit = 20) =>
        op.GuestsController_search<Guest[]>(call, { q, limit }).then(data),
    },
  };
}
