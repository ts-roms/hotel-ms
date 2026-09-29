'use client';

import type { TotpEnrollment } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  CardContent,
  Input,
  Label,
  Notice,
  SectionCard,
  Skeleton,
} from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession, useSetSession } from '@/lib/session';

export function MfaCard() {
  const session = useSession();
  const setSession = useSetSession();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const start = useMutation({ mutationFn: api.auth.startTotpEnrollment, onSuccess: setEnrollment });
  const confirm = useMutation({
    mutationFn: api.auth.confirmTotpEnrollment,
    onSuccess: (result) => {
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      setCode('');
      setPassword('');
      setSession(result.session);
    },
  });
  const disable = useMutation({
    mutationFn: api.auth.disableMfa,
    onSuccess: () => {
      setCode('');
      void session.refetch();
    },
  });

  useEffect(() => {
    // Rendered locally: the secret never leaves the browser to a QR service.
    if (enrollment)
      void QRCode.toDataURL(enrollment.otpauthUri, { margin: 1, width: 192 }).then(setQr);
    else setQr(null);
  }, [enrollment]);

  const enabled = session.data?.identity.mfaEnabled;
  const error = start.error ?? confirm.error ?? disable.error;

  return (
    <SectionCard
      icon={ShieldCheck}
      title={t('security.mfa')}
      description={enabled ? t('security.mfaOn') : t('security.mfaOff')}
      actions={
        session.data && (
          <Badge variant={enabled ? 'success' : 'neutral'} dot>
            {enabled ? 'on' : 'off'}
          </Badge>
        )
      }
    >
      <CardContent className="flex flex-col gap-4">
        {error && <Alert>{errorMessage(error)}</Alert>}

        {recoveryCodes && (
          <Notice className="flex flex-col gap-2">
            <strong>{t('security.recoveryTitle')}</strong>
            <span>{t('security.recoveryHint')}</span>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
              {recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Notice>
        )}

        {!enabled && !enrollment && (
          <Button onClick={() => start.mutate()} loading={start.isPending} className="self-start">
            {t('security.enable')}
          </Button>
        )}

        {enrollment && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              confirm.mutate({ code, password });
            }}
          >
            <p className="text-sm">{t('security.scan')}</p>
            {qr ? (
              <img
                src={qr}
                alt=""
                width={192}
                height={192}
                className="animate-scale-in rounded-xl border bg-white p-2 shadow-sm"
              />
            ) : (
              <Skeleton className="size-48 rounded-xl" />
            )}
            <code className="break-all rounded bg-muted px-2 py-1 text-sm">
              {enrollment.secret}
            </code>
            <Label htmlFor="enroll-code">{t('mfa.code')}</Label>
            <Input
              id="enroll-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Label htmlFor="enroll-password">{t('security.currentPassword')}</Label>
            <Input
              id="enroll-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              type="submit"
              loading={confirm.isPending}
              disabled={code.length !== 6 || password.length === 0}
              className="self-start"
            >
              {t('security.confirm')}
            </Button>
          </form>
        )}

        {enabled && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              disable.mutate({ code });
            }}
          >
            <Label htmlFor="disable-code">{t('security.disableHint')}</Label>
            <div className="flex gap-2">
              <Input
                id="disable-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button
                type="submit"
                variant="outline"
                loading={disable.isPending}
                disabled={code.length !== 6}
              >
                {t('security.disable')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </SectionCard>
  );
}
