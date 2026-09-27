import { z } from 'zod';

/**
 * Stable machine-readable error codes. Clients branch on `code`, never on `title`/`detail`.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'CSRF_FAILED',
  'MFA_REQUIRED',
  'MFA_ENROLLMENT_REQUIRED',
  'INVALID_MFA_CODE',
  'INVALID_TOKEN',
  'LAST_ADMINISTRATOR',
  'NO_AVAILABILITY',
  'ROOM_UNAVAILABLE',
  'INVALID_STATE',
  'ROOM_NOT_READY',
  'BALANCE_OUTSTANDING',
  'FEATURE_DISABLED',
  'GUEST_VERIFICATION_REQUIRED',
  'SEE_FRONT_DESK',
  'NO_ACTIVE_ORGANIZATION',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'PRECONDITION_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_IN_PROGRESS',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** RFC 9457 problem details, with our extensions. */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(ERROR_CODES),
  detail: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof problemSchema>;
