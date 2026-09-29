'use client';

import { passwordSchema } from '@hotel/contracts';
import { Alert, Button, CardContent, Input, Label, Notice, SectionCard } from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';

export function ChangePasswordCard() {
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
    <SectionCard icon={KeyRound} title={t('security.changePassword')}>
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
    </SectionCard>
  );
}
