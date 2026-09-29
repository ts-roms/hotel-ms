'use client';

import type { createKioskApiClient } from '@hotel/api-client';
import type { KioskState } from '@hotel/contracts';
import { Alert, Avatar, Button, CardContent } from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { Delete } from 'lucide-react';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';

type Kiosk = ReturnType<typeof createKioskApiClient>;

export function OperatorSignIn({
  kiosk,
  state,
  onSignedIn,
}: {
  kiosk: Kiosk;
  state: KioskState;
  onSignedIn: (s: KioskState) => void;
}) {
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
      description={
        operator ? t('kiosk.enterPinFor', { name: operator.name }) : t('kiosk.whoAreYou')
      }
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
