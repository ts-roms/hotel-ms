'use client';

import type { createApiClient, createKioskApiClient } from '@hotel/api-client';
import type { KioskState } from '@hotel/contracts';
import { Button, cn } from '@hotel/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useEffect } from 'react';
import { KitchenBoard } from '@/components/kitchen-board/kitchen-board';

type Kiosk = ReturnType<typeof createKioskApiClient>;
type DeviceApi = ReturnType<typeof createApiClient>;

export function KioskBoard({
  kiosk,
  deviceApi,
  state,
  onSignedOut,
}: {
  kiosk: Kiosk;
  deviceApi: DeviceApi;
  state: KioskState;
  onSignedOut: (s: KioskState) => void;
}) {
  const queryClient = useQueryClient();
  const signOut = useMutation({ mutationFn: kiosk.signOut, onSuccess: onSignedOut });
  const pms = deviceApi.pms(state.device.propertyId);
  // An expired or ended operator session sends the device back to the PIN screen.
  useEffect(() => {
    const expiresIn = Date.parse(state.operator!.expiresAt) - Date.now();
    const timer = setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: ['kiosk'] }),
      Math.max(0, expiresIn),
    );
    return () => clearTimeout(timer);
  }, [state.operator, queryClient]);
  return (
    <main className="min-h-dvh p-4">
      <KitchenBoard
        propertyId={state.device.propertyId}
        pms={pms}
        can={(permission) => (state.device.permissions as string[]).includes(permission)}
        headerExtra={
          <Button
            variant="ghost"
            size="sm"
            className={cn('gap-2')}
            loading={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            <LogOut className="size-4" />
            {state.operator!.name}
          </Button>
        }
      />
    </main>
  );
}
