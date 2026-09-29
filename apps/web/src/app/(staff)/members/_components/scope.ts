export const ORG_SCOPE = '__organization__';

/** '' means "not chosen yet": the select shows its first option, so use that. */
export function toPropertyId(scope: string, firstPropertyId: string | undefined): string | null {
  if (scope === ORG_SCOPE) return null;
  return scope || firstPropertyId || null;
}
