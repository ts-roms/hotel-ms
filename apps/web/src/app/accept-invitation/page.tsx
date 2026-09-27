'use client';

import { passwordSchema } from '@hotel/contracts';
import { Alert, Button, CardContent, Input, Label, Notice, Skeleton } from '@hotel/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
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
    <AuthShell
      title={t('invite.title')}
      description={
        preview.data ? (
          <>
            {t('invite.subtitle')} <strong>{preview.data.organizationName}</strong> (
            {preview.data.email})
          </>
        ) : undefined
      }
    >
      <CardContent className="flex flex-col gap-4">
        {(token === null || preview.isError) && <Alert>{t('reset.invalid')}</Alert>}
        {(token === undefined || (preview.isPending && token)) && (
          <div role="status" aria-busy="true" className="flex flex-col gap-3">
            <span className="sr-only">{t('loading')}</span>
            <Skeleton className="mx-auto h-4 w-3/4" />
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        )}
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
              <Button type="submit" size="lg" loading={accept.isPending}>
                {t('invite.accept')}
              </Button>
            </form>
          )
        )}
        <Link
          href="/login"
          className="text-center text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
        >
          {t('login.title')}
        </Link>
      </CardContent>
    </AuthShell>
  );
}
