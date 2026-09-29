'use client';

import { ApiError, createApiClient, createKioskApiClient } from '@hotel/api-client';
import type { KioskState } from '@hotel/contracts';
import { Alert, Avatar, Button, CardContent, cn, Input, LoadingRegion, Skeleton } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Delete, LogOut } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { KitchenBoard } from '@/components/kitchen-board';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { KioskTimeClock } from './_components/kiosk-time-clock';

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
  if (unpaired || !state.data) return <Pair onPaired={set} error={unpaired ? null : state.error} />;
  if (state.data.device.kind === 'TIME_CLOCK')
    return <KioskTimeClock state={state.data} kiosk={kiosk} />;
  if (!state.data.operator) return <SignIn state={state.data} onSignedIn={set} />;
  return <Board state={state.data} onSignedOut={set} />;
}

function Pair({ onPaired, error }: { onPaired: (s: KioskState) => void; error: unknown }) {
  const [code, setCode] = useState('');
  const pair = useMutation({ mutationFn: () => kiosk.pair(code), onSuccess: onPaired });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    pair.mutate();
  };
  return (
    <AuthShell title={t('kiosk.pairTitle')} description={t('kiosk.pairHint')}>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {(error || pair.error) && <Alert>{errorMessage(pair.error ?? error)}</Alert>}
          <Input
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            aria-label={t('kiosk.pairingCode')}
            placeholder="ABCD-2345"
            className="text-center font-mono text-lg tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" loading={pair.isPending} disabled={code.trim().length < 8}>
            {t('kiosk.pair')}
          </Button>
        </form>
      </CardContent>
    </AuthShell>
  );
}

function SignIn({ state, onSignedIn }: { state: KioskState; onSignedIn: (s: KioskState) => void }) {
  const [who, setWho] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const signIn = useMutation({
    mutationFn: () => kiosk.signIn(who!, pin),
    onSuccess: onSignedIn,
    onError: () => setPin(''),
  });
  const press = (digit: string) => setPin((p) => (p.length < 8 ? p + digit : p));
  const operator = state.operators.find((o) => o.membershipId === who);

  return (
    <AuthShell
      title={`${state.device.name} · ${state.device.propertyName}`}
      description={operator ? `${t('kiosk.enterPin')} ${operator.name}` : t('kiosk.whoAreYou')}
      className="max-w-md"
    >
      <CardContent className="flex flex-col gap-3">
        {signIn.error && <Alert>{errorMessage(signIn.error)}</Alert>}
        {!operator ? (
          state.operators.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">{t('kiosk.noOperators')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {state.operators.map((o) => (
                <Button
                  key={o.membershipId}
                  type="button"
                  variant="outline"
                  onClick={() => setWho(o.membershipId)}
                  className="h-auto justify-start whitespace-normal p-3 text-left font-normal text-foreground"
                >
                  <Avatar name={o.name} className="size-8" />
                  {o.name}
                </Button>
              ))}
            </div>
          )
        ) : (
          <form
            className="flex flex-col items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (pin.length >= 4) signIn.mutate();
            }}
          >
            <div
              aria-label={t('kiosk.pin')}
              className="flex h-10 items-center gap-2 font-mono text-2xl tracking-widest"
            >
              {pin.replace(/./g, '•') || <span className="text-muted-foreground">····</span>}
            </div>
            <div className="grid w-64 grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <Button key={d} type="button" variant="outline" size="lg" onClick={() => press(d)}>
                  {d}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="lg"
                aria-label={t('kiosk.backspace')}
                onClick={() => setPin((p) => p.slice(0, -1))}
              >
                <Delete />
              </Button>
              <Button type="button" variant="outline" size="lg" onClick={() => press('0')}>
                0
              </Button>
              <Button type="submit" size="lg" loading={signIn.isPending} disabled={pin.length < 4}>
                OK
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setWho(null);
                setPin('');
              }}
            >
              {t('kiosk.notMe')}
            </Button>
          </form>
        )}
      </CardContent>
    </AuthShell>
  );
}

function Board({
  state,
  onSignedOut,
}: {
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
