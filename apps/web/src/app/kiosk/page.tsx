'use client';

import { ApiError, createApiClient, createKioskApiClient } from '@hotel/api-client';
import type { KioskState } from '@hotel/contracts';
import { LoadingRegion, Skeleton } from '@hotel/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@/lib/i18n';
import { KioskBoard } from './_components/kiosk-board';
import { KioskTimeClock } from './_components/kiosk-time-clock';
import { OperatorSignIn } from './_components/operator-sign-in';
import { PairDevice } from './_components/pair-device';

// The device's CSRF token, from the latest kiosk response. Memory only.
let csrfToken: string | undefined;
const kiosk = createKioskApiClient({ getCsrfToken: () => csrfToken });
const deviceApi = createApiClient({ getCsrfToken: () => csrfToken });

const remember = (state: KioskState) => {
  csrfToken = state.csrfToken;
  return state;
};

/**
 * Shared kitchen device (ADR-0020): paired once by a manager's code, then staff sign in
 * with their PIN. The board works with the intersection of the device's permissions and
 * the operator's own.
 */
export default function KioskPage() {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: ['kiosk'],
    queryFn: () => kiosk.state().then(remember),
    retry: false,
    // Picks up an operator session that went idle, expired or was ended elsewhere.
    refetchInterval: 60_000,
  });
  const set = (next: KioskState) => queryClient.setQueryData(['kiosk'], remember(next));

  if (state.isPending) {
    return (
      <LoadingRegion label={t('loading')} className="flex min-h-dvh items-center justify-center">
        <Skeleton className="h-40 w-80 rounded-xl" />
      </LoadingRegion>
    );
  }
  const unpaired = state.error instanceof ApiError && state.error.status === 401;
  if (unpaired || !state.data)
    return <PairDevice kiosk={kiosk} onPaired={set} error={unpaired ? null : state.error} />;
  if (state.data.device.kind === 'TIME_CLOCK')
    return <KioskTimeClock state={state.data} kiosk={kiosk} />;
  if (!state.data.operator)
    return <OperatorSignIn kiosk={kiosk} state={state.data} onSignedIn={set} />;
  return <KioskBoard kiosk={kiosk} deviceApi={deviceApi} state={state.data} onSignedOut={set} />;
}
