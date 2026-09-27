import { ApiError, createGuestApiClient } from '@hotel/api-client';
import type { GuestStay } from '@hotel/contracts';

// CSRF token from the most recent stay response. Memory only; the guest session cookie
// itself is HttpOnly.
let csrfToken: string | undefined;

export function rememberStay(stay: GuestStay | undefined): GuestStay | undefined {
  if (stay) csrfToken = stay.csrfToken;
  return stay;
}

export const api = createGuestApiClient({ getCsrfToken: () => csrfToken });

/** Reads `token` from the URL fragment (#token=...), which is never sent to servers. */
export function tokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.hash.slice(1)).get('token');
}

const MESSAGES: Partial<Record<string, string>> = {
  INVALID_TOKEN: 'This link is no longer valid. Ask the hotel to send you a new one.',
  UNAUTHENTICATED: 'Your session has ended. Open the link from your email again.',
  INVALID_MFA_CODE: 'That code did not work. Check the latest email and try again.',
  RATE_LIMITED: 'Too many attempts. Wait a few minutes and try again.',
};

/** Guest-facing message for an API failure; the server's detail is written for guests. */
export function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (error.code === 'VALIDATION_FAILED') {
    return error.problem.errors?.map((e) => e.message).join(' ') ?? error.message;
  }
  return MESSAGES[error.code] ?? error.problem.detail ?? error.problem.title;
}

/** Formats minor units in the currency's own number of decimals. */
export function formatMoney(amountMinor: number, currency: string, locale = 'en-PH'): string {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** digits);
}

/** "2026-10-05" → "Mon, Oct 5" (calendar date; no time zone shifts). */
export function formatDate(isoDate: string, locale = 'en-PH'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}
