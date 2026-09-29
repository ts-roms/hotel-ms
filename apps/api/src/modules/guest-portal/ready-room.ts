import { isConstraintViolation } from '../../common/db-errors.js';

/**
 * Assigns the first candidate room that is still free: a room another check-in took in the
 * meantime loses on the room_assignments exclusion constraint, and the next candidate is
 * tried. Any other error is a real failure and is rethrown. Returns the assigned candidate,
 * or null when every candidate was taken.
 */
export async function assignFirstFree<T>(
  candidates: readonly T[],
  assign: (candidate: T) => Promise<void>,
): Promise<T | null> {
  for (const candidate of candidates) {
    try {
      await assign(candidate);
      return candidate;
    } catch (error) {
      if (!isConstraintViolation(error, 'room_assignments_no_overlap')) throw error;
    }
  }
  return null;
}
