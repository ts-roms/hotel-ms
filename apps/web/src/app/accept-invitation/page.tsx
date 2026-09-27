'use client';

import { passwordSchema } from '@hotel/contracts';
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
  Notice,
} from '@hotel/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage, tokenFromHash } from '@/lib/errors';
import { t } from '@/lib/i18n';

export default function AcceptInvitationPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    // Read once, then drop the token from the address bar and history. Effects can run
    // twice (React strict mode), so a later empty read must not overwrite the token.
    const fromHash = tokenFromHash();
    if (fromHash) history.replaceState(null, '', window.location.pathname);
    setToken((previous) => fromHash ?? previous ?? null);
  }, []);

  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => api.auth.previewInvitation(token!),
    enabled: !!token,
    retry: false,
  });
  const accept = useMutation({ mutationFn: api.auth.acceptInvitation });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!token || !preview.data) return;
    if (preview.data.requiresPassword) {
      const check = passwordSchema.safeParse(password);
      if (!check.success) {
        setClientError(check.error.issues[0]?.message ?? null);
        return;
      }
    }
    setClientError(null);
    accept.mutate({ token, ...(preview.data.requiresPassword ? { password } : {}) });
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('invite.title')}</CardTitle>
          {preview.data && (
            <CardDescription>
              {t('invite.subtitle')} <strong>{preview.data.organizationName}</strong> (
              {preview.data.email})
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {(token === null || preview.isError) && <Alert>{t('reset.invalid')}</Alert>}
          {preview.isPending && token && <p className="text-muted-foreground">{t('loading')}</p>}
          {accept.isSuccess ? (
            <Notice>{t('invite.done')}</Notice>
          ) : (
            preview.data && (
              <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
                {(clientError || accept.error) && (
                  <Alert>{clientError ?? errorMessage(accept.error)}</Alert>
                )}
                {preview.data.requiresPassword ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="password">{t('invite.choosePassword')}</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t('reset.hint')}</p>
                  </div>
                ) : (
                  <Notice>{t('invite.existingAccount')}</Notice>
                )}
                <Button type="submit" disabled={accept.isPending}>
                  {t('invite.accept')}
                </Button>
              </form>
            )
          )}
          <Link href="/login" className="text-center text-sm text-muted-foreground underline">
            {t('login.title')}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
