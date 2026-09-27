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

export function useSetSession() {
  const queryClient = useQueryClient();
  return (info: SessionInfo | null) => {
    rememberSession(info ?? undefined);
    // Everything cached belongs to the previous identity/organization/privilege level.
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] });
    queryClient.setQueryData(SESSION_KEY, info);
  };
}

/** Where a signed-in session should go next. */
export function nextRoute(info: SessionInfo): string {
  if (info.mfaPending) return '/login/verify';
  if (!info.activeOrganizationId) return '/select-organization';
  return '/dashboard';
}

export function useLogin() {
  const setSession = useSetSession();
  return useMutation({
    mutationFn: api.auth.login,
    onSuccess: (info) => setSession(info),
  });
}

export function useMfaChallenge() {
  const setSession = useSetSession();
  return useMutation({
    mutationFn: api.auth.mfaChallenge,
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

/** Has this permission anywhere in the active organization (for showing navigation). */
export function hasPermission(info: SessionInfo | null | undefined, permission: string): boolean {
  return !!info?.grants.some((g) => g.permission === permission);
}
