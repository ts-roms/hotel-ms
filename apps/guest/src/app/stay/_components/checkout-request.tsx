'use client';

import { type GuestStay } from '@hotel/contracts';
import { Alert, Button, CardContent, Input, Label } from '@hotel/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Section } from '@/components/section';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';

/** "Ready to leave?": asks the front desk to prepare the checkout. */
export function CheckoutRequest({ stay: s }: { stay: GuestStay }) {
  const queryClient = useQueryClient();
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const request = useMutation({
    mutationFn: () => api.requestCheckout({ time: time || null, note: note.trim() }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stay'] }),
        queryClient.invalidateQueries({ queryKey: ['requests'] }),
      ]),
  });
  if (s.checkoutRequested) {
    return (
      <Section
        icon={<LogOut />}
        title={t('checkout.requestedTitle')}
        description={t('checkout.requestedDescription')}
      />
    );
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    request.mutate();
  };
  return (
    <Section
      icon={<LogOut />}
      title={t('checkout.title')}
      description={t('checkout.description', { time: s.property.checkOutTime })}
    >
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          {request.error && <Alert>{errorMessage(request.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="checkout-time">{t('checkout.time')}</Label>
            <Input
              id="checkout-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="checkout-note">{t('checkout.note')}</Label>
            <Input
              id="checkout-note"
              maxLength={500}
              placeholder={t('checkout.notePlaceholder')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" variant="outline" loading={request.isPending}>
            {!request.isPending && <LogOut />}
            {t('checkout.submit')}
          </Button>
        </form>
      </CardContent>
    </Section>
  );
}
