/**
 * Property-local wall-clock time ↔ instants. The implementation is shared with the worker
 * and the web apps in @hotel/format; this module keeps the API's import path stable.
 */
export { fromLocal, localToday, toLocal } from '@hotel/format';
