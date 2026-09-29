'use client';

import { type UseMutationOptions, useMutation } from '@tanstack/react-query';

/**
 * A mutation whose variable is the API call itself: `action.mutate(() => pms.closeFolio(id))`.
 * For screens where several buttons share one pending/error state; the options are
 * `useMutation`'s (onSuccess receives the call's result).
 */
export function useAction<T = unknown>(
  options: Omit<UseMutationOptions<T, Error, () => Promise<T>>, 'mutationFn'> = {},
) {
  return useMutation({ ...options, mutationFn: (run: () => Promise<T>) => run() });
}
