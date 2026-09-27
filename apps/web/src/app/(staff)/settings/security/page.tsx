'use client';

import { passwordSchema, type TotpEnrollment } from '@hotel/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Badge,
  Label,
  Notice,
  PageHeader,
  Skeleton,
} from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession, useSetSession } from '@/lib/session';

export default function SecurityPage() {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader title={t('security.title')} />
      <div className="stagger flex flex-col gap-6">
        <MfaCard />
        <ChangePasswordCard />
      </div>
    </div>
  );
}

function MfaCard() {
  const session = useSession();
  const setSession = useSetSession();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const start = useMutation({ mutationFn: api.auth.startTotpEnrollment, onSuccess: setEnrollment });
  const confirm = useMutation({
    mutationFn: api.auth.confirmTotpEnrollment,
    onSuccess: (result) => {
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      setCode('');
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" />
            {t('security.mfa')}
          </CardTitle>
          {session.data && (
            <Badge variant={enabled ? 'success' : 'neutral'} dot>
              {enabled ? 'on' : 'off'}
            </Badge>
          )}
        </div>
        <CardDescription>{enabled ? t('security.mfaOn') : t('security.mfaOff')}</CardDescription>
      </CardHeader>
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
              confirm.mutate(code);
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
            <Button
              type="submit"
              loading={confirm.isPending}
              disabled={code.length !== 6}
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
    </Card>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: api.auth.changePassword,
    onSuccess: () => {
      setCurrent('');
      setNew('');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-primary" />
          {t('security.changePassword')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const check = passwordSchema.safeParse(newPassword);
            setClientError(check.success ? null : (check.error.issues[0]?.message ?? null));
            if (check.success) change.mutate({ currentPassword, newPassword });
          }}
        >
          {(clientError || change.error) && (
            <Alert>{clientError ?? errorMessage(change.error)}</Alert>
          )}
          {change.isSuccess && <Notice>{t('security.passwordChanged')}</Notice>}
          <Label htmlFor="current">{t('security.currentPassword')}</Label>
          <Input
            id="current"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <Label htmlFor="new">{t('reset.newPassword')}</Label>
          <Input
            id="new"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('reset.hint')}</p>
          <Button type="submit" loading={change.isPending} className="self-start">
            {t('security.changePassword')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
