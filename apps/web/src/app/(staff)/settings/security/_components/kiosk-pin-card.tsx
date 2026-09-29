'use client';

import { Alert, Button, CardContent, Input, Label, Notice, SectionCard } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Grid3x3 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';

/** PIN for shared kitchen devices (ADR-0020). Needs the password to set or change. */
export function KioskPinCard() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['my-pin'], queryFn: api.me.pin, retry: false });
  const [pin, setPin] = useState('');
  const [currentPassword, setCurrent] = useState('');
  const save = useMutation({
    mutationFn: () => api.me.setPin(pin, currentPassword),
    onSuccess: (data) => {
      setPin('');
      setCurrent('');
      queryClient.setQueryData(['my-pin'], data);
    },
  });
  const remove = useMutation({
    mutationFn: api.me.removePin,
    onSuccess: (data) => queryClient.setQueryData(['my-pin'], data),
  });
  // Members without an organization context have nothing to sign in to.
  if (status.error) return null;
  return (
    <SectionCard icon={Grid3x3} title={t('pin.title')} description={t('pin.hint')}>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {(save.error || remove.error) && (
            <Alert>{errorMessage(save.error ?? remove.error)}</Alert>
          )}
          {save.isSuccess && <Notice>{t('pin.saved')}</Notice>}
          <p className="text-sm text-muted-foreground">
            {status.data?.hasPin ? t('pin.isSet') : t('pin.notSet')}
          </p>
          <Label htmlFor="pin">{t('pin.new')}</Label>
          <Input
            id="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          <Label htmlFor="pin-password">{t('pin.current')}</Label>
          <Input
            id="pin-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              loading={save.isPending}
              disabled={pin.length < 4 || !currentPassword}
            >
              {status.data?.hasPin ? t('pin.change') : t('pin.set')}
            </Button>
            {status.data?.hasPin && (
              <Button
                type="button"
                variant="ghost"
                loading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {t('pin.remove')}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </SectionCard>
  );
}
