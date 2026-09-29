'use client';

import { tokenFromHash } from '@hotel/api-client';
import { passwordSchema } from '@hotel/contracts';
import { Alert, Button, CardContent, Input, Label, Notice } from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthCard } from '@/components/auth-shell';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);
  const reset = useMutation({ mutationFn: api.auth.resetPassword });

  useEffect(() => {
    // Read once, then drop the token from the address bar and history. Effects can run
    // twice (React strict mode), so a later empty read must not overwrite the token.
    const fromHash = tokenFromHash();
    if (fromHash) history.replaceState(null, '', window.location.pathname);
    setToken((previous) => fromHash ?? previous ?? null);
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const check = passwordSchema.safeParse(password);
    setClientError(check.success ? null : (check.error.issues[0]?.message ?? null));
    if (check.success && token) reset.mutate({ token, newPassword: password });
  };

  return (
    <AuthCard title={t('reset.title')}>
      <CardContent className="flex flex-col gap-4">
        {token === null && <Alert>{t('reset.invalid')}</Alert>}
        {reset.isSuccess ? (
          <Notice>{t('reset.done')}</Notice>
        ) : (
          token && (
            <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              {(clientError || reset.error) && (
                <Alert>{clientError ?? errorMessage(reset.error)}</Alert>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">{t('reset.newPassword')}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('reset.hint')}</p>
              </div>
              <Button type="submit" size="lg" loading={reset.isPending}>
                {t('reset.submit')}
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
    </AuthCard>
  );
}
