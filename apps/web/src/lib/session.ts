'use client';

import { ApiError } from '@hotel/api-client';
import type { SessionInfo } from '@hotel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, rememberSession } from './api';

export const SESSION_KEY = ['session'] as const;

/** null = signed out. */
export function useSession() {
  return useQuery<SessionInfo | null>({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        const info = await api.auth.session();
        rememberSession(info);
        return info;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          rememberSession(undefined);
          return null;
        }
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

function useSetSession() {
  const queryClient = useQueryClient();
  return (info: SessionInfo | null) => {
    rememberSession(info ?? undefined);
    // Everything cached belongs to the previous identity/organization.
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] });
    queryClient.setQueryData(SESSION_KEY, info);
  };
}

export function useLogin() {
  const setSession = useSetSession();
  return useMutation({
    mutationFn: api.auth.login,
    onSuccess: (info) => setSession(info),
  });
}

export function useLogout() {
  const setSession = useSetSession();
  return useMutation({
    mutationFn: api.auth.logout,
    onSettled: () => setSession(null),
  });
}

export function useSwitchOrganization() {
  const setSession = useSetSession();
  return useMutation({
    mutationFn: api.auth.switchOrganization,
    onSuccess: (info) => setSession(info),
  });
}
