import type { Birthday } from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { items, type PropertyTransport } from '../../http.js';

/** HR workforce at a property: upcoming staff birthdays. */
export function workforceClient({ call, propertyId }: PropertyTransport) {
  return {
    birthdays: () =>
      op.BirthdaysController_birthdays<{ items: Birthday[] }>(call, { propertyId }).then(items),
  };
}
