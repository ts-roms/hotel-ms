import { ApiError, createGuestApiClient, problemText } from '@hotel/api-client';
import type { GuestStay } from '@hotel/contracts';
import { type MessageKey, t } from './i18n';

// CSRF token from the most recent stay response. Memory only; the guest session cookie
// itself is HttpOnly.
let csrfToken: string | undefined;

export function rememberStay(stay: GuestStay | undefined): GuestStay | undefined {
  if (stay) csrfToken = stay.csrfToken;
  return stay;
}

export const api = createGuestApiClient({ getCsrfToken: () => csrfToken });

// Error codes with a guest-specific message; others show the server's detail.
const MESSAGES: Partial<Record<string, MessageKey>> = {
  INVALID_TOKEN: 'error.INVALID_TOKEN',
  UNAUTHENTICATED: 'error.UNAUTHENTICATED',
  INVALID_MFA_CODE: 'error.INVALID_MFA_CODE',
  RATE_LIMITED: 'error.RATE_LIMITED',
};

/** Guest-facing message for an API failure; the server's detail is written for guests. */
export function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (!(error instanceof ApiError)) return t('error.generic');
  const key = MESSAGES[error.code];
  return key ? t(key) : problemText(error);
}
