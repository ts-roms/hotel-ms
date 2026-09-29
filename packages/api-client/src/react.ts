/**
 * TanStack Query wiring shared by the staff and guest apps (blueprint §6.3). Imported via
 * `@hotel/api-client/react`, so the plain clients stay free of React.
 */
import { QueryClient, useIsFetching, useIsMutating } from '@tanstack/react-query';
import { ApiError } from './http.js';

/** Query client with the apps' defaults. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Never retry authorization or validation failures; they will not change.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status < 500) && failureCount < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** True while any query or mutation is in flight (for a global progress bar). */
export function useRequestsInFlight(): boolean {
  return useIsFetching() + useIsMutating() > 0;
}
