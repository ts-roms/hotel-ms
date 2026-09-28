'use client';

import { Alert, Button, CardContent, Input, Label } from '@hotel/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { nextRoute, useMfaChallenge, useSession } from '@/lib/session';

export default function VerifyPage() {
  const router = useRouter();
  const session = useSession();
  const challenge = useMfaChallenge();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (session.data === null) router.replace('/login');
    else if (session.data && !session.data.mfaPending) router.replace(nextRoute(session.data));
  }, [session.data, router]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const body = useRecovery ? { recoveryCode: value.trim() } : { code: value.replace(/\s/g, '') };
    const info = await challenge.mutateAsync(body).catch(() => null);
    if (info) router.replace(nextRoute(info));
  };

  return (
    <AuthShell title={t('mfa.title')} description={t('mfa.subtitle')}>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {challenge.error && <Alert>{errorMessage(challenge.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">{useRecovery ? t('mfa.recoveryCode') : t('mfa.code')}</Label>
            <Input
              id="code"
              autoFocus
              autoComplete="one-time-code"
              inputMode={useRecovery ? 'text' : 'numeric'}
              maxLength={useRecovery ? 11 : 6}
              className={
                useRecovery ? undefined : 'h-12 text-center font-mono text-xl tracking-[0.5em]'
              }
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" loading={challenge.isPending} disabled={value.length < 6}>
            {t('mfa.verify')}
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 font-normal text-muted-foreground hover:text-primary"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setValue('');
            }}
          >
            {useRecovery ? t('mfa.useApp') : t('mfa.useRecovery')}
          </Button>
        </form>
      </CardContent>
    </AuthShell>
  );
}
