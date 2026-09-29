'use client';

import { type GuestStay } from '@hotel/contracts';
import { Alert, Button, Card, CardContent, Input, Label, SectionCard, Textarea } from '@hotel/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Clock } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, errorMessage, rememberStay } from '@/lib/api';
import { rich, t } from '@/lib/i18n';

export function PreCheckIn({ stay: s }: { stay: GuestStay }) {
  const queryClient = useQueryClient();
  const [arrival, setArrival] = useState(s.stay.expectedArrivalTime ?? s.property.checkInTime);
  const [phone, setPhone] = useState('');
  const [requests, setRequests] = useState('');
  const [editing, setEditing] = useState(!s.stay.preCheckInCompleted);
  const save = useMutation({
    mutationFn: () =>
      api.preCheckIn({
        expectedArrivalTime: arrival,
        phone: phone.trim() || null,
        specialRequests: requests.trim(),
      }),
    onSuccess: (stay) => {
      queryClient.setQueryData(['stay'], rememberStay(stay));
      setEditing(false);
    },
  });
  if (!editing) {
    return (
      <Card className="flex items-center gap-3 border-success/30 bg-success/5 p-4 text-sm">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          <Check className="size-4" />
        </span>
        <span className="flex-1">
          {rich('preCheckIn.thanks', { time: <strong>{s.stay.expectedArrivalTime}</strong> })}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {t('preCheckIn.change')}
        </Button>
      </Card>
    );
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <SectionCard
      variant="badge"
      icon={Clock}
      title={t('preCheckIn.title')}
      description={t('preCheckIn.description')}
    >
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {save.error && <Alert>{errorMessage(save.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="arrival">{t('preCheckIn.arrival')}</Label>
            <Input
              id="arrival"
              type="time"
              value={arrival}
              onChange={(e) => setArrival(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="phone">{t('preCheckIn.phone')}</Label>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="requests">{t('preCheckIn.requests')}</Label>
            <Textarea
              id="requests"
              maxLength={1000}
              value={requests}
              onChange={(e) => setRequests(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" loading={save.isPending}>
            {t('preCheckIn.save')}
          </Button>
        </form>
      </CardContent>
    </SectionCard>
  );
}
