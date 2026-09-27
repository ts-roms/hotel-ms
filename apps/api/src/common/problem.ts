import type { ErrorCode, Problem } from '@hotel/contracts';

type FieldError = NonNullable<Problem['errors']>[number];

/**
 * The only exception type domain and application code should throw for expected errors.
 * Rendered as RFC 9457 application/problem+json by ProblemFilter.
 */
export class ProblemException extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: FieldError[],
    readonly headers?: Record<string, string>,
  ) {
    super(detail ?? title);
    this.name = 'ProblemException';
  }
}

export const Problems = {
  validation: (errors: FieldError[]) =>
    new ProblemException(400, 'VALIDATION_FAILED', 'Request validation failed', undefined, errors),
  unauthenticated: () => new ProblemException(401, 'UNAUTHENTICATED', 'Authentication required'),
  invalidCredentials: () =>
    new ProblemException(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
  csrf: () => new ProblemException(403, 'CSRF_FAILED', 'CSRF validation failed'),
  noActiveOrganization: () =>
    new ProblemException(
      403,
      'NO_ACTIVE_ORGANIZATION',
      'Select an organization first',
      'This session has no active organization membership.',
    ),
  forbidden: (detail?: string) => new ProblemException(403, 'FORBIDDEN', 'Not allowed', detail),
  /** Also used for resources outside the caller's tenant/scope, so existence is not leaked. */
  notFound: (what = 'Resource') => new ProblemException(404, 'NOT_FOUND', `${what} not found`),
  conflict: (detail: string) => new ProblemException(409, 'CONFLICT', 'Conflict', detail),
  preconditionRequired: () =>
    new ProblemException(
      428,
      'PRECONDITION_REQUIRED',
      'If-Match header required',
      'Send the ETag from your last read in If-Match.',
    ),
  versionConflict: () =>
    new ProblemException(
      412,
      'VERSION_CONFLICT',
      'Resource was modified',
      'Someone else changed this resource. Reload and try again.',
    ),
  rateLimited: (retryAfterSeconds: number) =>
    new ProblemException(429, 'RATE_LIMITED', 'Too many requests', undefined, undefined, {
      'retry-after': String(retryAfterSeconds),
    }),
};
