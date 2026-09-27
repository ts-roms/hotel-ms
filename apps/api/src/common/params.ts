import { z } from 'zod';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Path ids: a malformed id is treated like a well-formed id that does not exist, so both
 * answer 404 and callers learn nothing from the difference.
 */
export function uuidParam(value: string): string {
  return z.uuid().safeParse(value).success ? value : NIL_UUID;
}
