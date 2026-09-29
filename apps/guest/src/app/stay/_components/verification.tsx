'use client';

import { type GuestStay } from '@hotel/contracts';
import { Alert, Button, CardContent, Input, Label, Notice, SectionCard } from '@hotel/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, errorMessage, rememberStay } from '@/lib/api';
import { rich, t } from '@/lib/i18n';

export function Verification({ stay: s }: { stay: GuestStay }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const send = useMutation({ mutationFn: api.requestCode });
  const verify = useMutation({
    mutationFn: (value: string) => api.verifyCode(value),
    onSuccess: (stay) => queryClient.setQueryData(['stay'], rememberStay(stay)),
  });
  if (!s.verificationDestination) {
    return <Notice>{t('verify.noEmail')}</Notice>;
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    verify.mutate(code.trim());
  };
  return (
    <SectionCard
      variant="badge"
      icon={ShieldCheck}
      title={t('verify.title')}
      description={rich('verify.description', {
        destination: <strong className="text-foreground">{s.verificationDestination}</strong>,
      })}
    >
      <CardContent className="flex flex-col gap-3">
        {(send.error || verify.error) && <Alert>{errorMessage(send.error ?? verify.error)}</Alert>}
        {!send.isSuccess ? (
          <Button size="lg" onClick={() => send.mutate()} loading={send.isPending}>
            {!send.isPending && <Mail />}
            {t('verify.emailCode')}
          </Button>
        ) : (
          <form onSubmit={onSubmit} className="flex animate-fade-in flex-col gap-3" noValidate>
            <Label htmlFor="code">{t('verify.code')}</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button
              type="submit"
              size="lg"
              loading={verify.isPending}
              disabled={code.trim().length !== 6}
            >
              {t('verify.confirm')}
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              loading={send.isPending}
              onClick={() => send.mutate()}
            >
              {t('verify.resend')}
            </Button>
          </form>
        )}
      </CardContent>
    </SectionCard>
  );
}
