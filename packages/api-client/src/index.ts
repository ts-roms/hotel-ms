/**
 * Typed clients for the staff app, the guest portal and shared devices. Request and
 * response types come from @hotel/contracts; the request functions are generated from the
 * OpenAPI document. Staff endpoints are grouped by bounded context under staff/ (one file per
 * API module, ADR-0031); see ADR-0009 and ADR-0034.
 */
export { ApiError, type ApiClientOptions, type Page, problemText } from './http.js';
export { tokenFromHash } from './url-token.js';
export { type ApiClient, createApiClient } from './staff/index.js';
export { createGuestApiClient, type GuestApiClient } from './guest.js';
export { createKioskApiClient } from './kiosk.js';
