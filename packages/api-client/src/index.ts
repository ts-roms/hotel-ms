/**
 * Typed clients for the staff app, the guest portal and shared devices. Request and
 * response types come from @hotel/contracts. Staff endpoints are grouped by bounded
 * context under staff/; see ADR-0009.
 */
export { ApiError, type ApiClientOptions, type Page } from './http.js';
export { type ApiClient, createApiClient } from './staff/index.js';
export { createGuestApiClient, type GuestApiClient } from './guest.js';
export { createKioskApiClient } from './kiosk.js';
