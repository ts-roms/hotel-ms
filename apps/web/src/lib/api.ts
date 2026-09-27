import { createApiClient } from '@hotel/api-client';
import type { SessionInfo } from '@hotel/contracts';

// CSRF token from the most recent session response (login, session, org switch). Kept
// in memory only; the session cookie itself is HttpOnly and never visible to JS.
let csrfToken: string | undefined;

export function rememberSession(info: SessionInfo | undefined): void {
  csrfToken = info?.csrfToken;
}

export const api = createApiClient({ getCsrfToken: () => csrfToken });
