import { Prisma } from '@hotel/database';
import { ProblemException } from './problem.js';

/**
 * Database constraints are the last line of defence for business rules (blueprint §7.4).
 * When one fires, translate it into the same problem the application check would have
 * produced, instead of a 500.
 */
const CONSTRAINT_PROBLEMS: Record<string, () => ProblemException> = {
  inventory_nights_not_oversold: () =>
    new ProblemException(
      409,
      'NO_AVAILABILITY',
      'No availability',
      'The room type is sold out for at least one night.',
    ),
  room_assignments_no_overlap: () =>
    new ProblemException(
      409,
      'ROOM_UNAVAILABLE',
      'Room not available',
      'The room is already held for overlapping nights.',
    ),
  room_assignments_one_active_per_reservation_room: () =>
    new ProblemException(409, 'CONFLICT', 'Conflict', 'This booking already has a room assigned.'),
};

function describe(error: unknown): string {
  if (!(error instanceof Error)) return '';
  const meta =
    error instanceof Prisma.PrismaClientKnownRequestError ? JSON.stringify(error.meta ?? {}) : '';
  const cause = (error as { cause?: unknown }).cause;
  return `${error.message} ${meta} ${cause instanceof Error ? cause.message : ''}`;
}

/** Rethrows a mapped problem for known constraint violations; otherwise rethrows as is. */
export function rethrowConstraintError(error: unknown): never {
  const text = describe(error);
  for (const [constraint, problem] of Object.entries(CONSTRAINT_PROBLEMS)) {
    if (text.includes(constraint)) throw problem();
  }
  throw error;
}

export async function withConstraintMapping<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ProblemException) throw error;
    rethrowConstraintError(error);
  }
}
