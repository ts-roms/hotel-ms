'use client';

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@hotel/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
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
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('mfa.title')}</CardTitle>
          <CardDescription>{t('mfa.subtitle')}</CardDescription>
        </CardHeader>
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
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={challenge.isPending || value.length < 6}>
              {t('mfa.verify')}
            </Button>
            <button
              type="button"
              className="text-sm text-muted-foreground underline"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setValue('');
              }}
            >
              {useRecovery ? t('mfa.useApp') : t('mfa.useRecovery')}
            </button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
