'use client';

import type { createKioskApiClient } from '@hotel/api-client';
import type { KioskState } from '@hotel/contracts';
import { Alert, Button, CardContent, Input } from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';

type Kiosk = ReturnType<typeof createKioskApiClient>;

export function PairDevice({
  kiosk,
  onPaired,
  error,
}: {
  kiosk: Kiosk;
  onPaired: (s: KioskState) => void;
  error: unknown;
}) {
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
