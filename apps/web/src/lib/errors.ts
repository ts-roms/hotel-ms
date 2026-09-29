import { ApiError } from '@hotel/api-client';
import { t } from './i18n';

/**
 * User-facing message for an API failure. For 4xx problems the server's detail says what
 * went wrong (room not available, wrong state, ...), so it is shown; 5xx stays generic.
 */
export function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (!(error instanceof ApiError)) return t('error.generic');
  switch (error.code) {
    case 'MFA_ENROLLMENT_REQUIRED':
      return t('error.mfaRequired');
    case 'INVALID_MFA_CODE':
      return t('mfa.invalid');
    case 'RATE_LIMITED':
      return t('login.rateLimited');
    case 'INVALID_TOKEN':
      return t('reset.invalid');
    case 'VALIDATION_FAILED':
      return error.problem.errors?.map((e) => e.message).join(' ') ?? error.message;
    case 'FORBIDDEN':
      return error.problem.detail ?? t('error.forbidden');
    default:
      return error.status < 500
        ? (error.problem.detail ?? error.problem.title)
        : t('error.generic');
  }
}

/** Reads `token` from the URL fragment (#token=...), which is never sent to servers. */
export function tokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.hash.slice(1)).get('token');
}
