'use client';

import { type GuestStay, type SelfCheckInResult } from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  SectionCard,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, DoorOpen, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { rich, t } from '@/lib/i18n';

export function SelfCheckIn({
  stay: s,
  onCheckedIn,
}: {
  stay: GuestStay;
  onCheckedIn: (result: SelfCheckInResult) => void;
}) {
  const queryClient = useQueryClient();
  const checkIn = useMutation({
    mutationFn: api.selfCheckIn,
    onSuccess: (result) => {
      onCheckedIn(result);
      return queryClient.invalidateQueries({ queryKey: ['stay'] });
    },
  });
  // Back from the card provider: ?hold=<intent id>. Wait for its confirmation.
  const [returned] = useState(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('hold'),
  );
  const holdPending = !!s.cardHold && !s.cardHold.authorized;
  const payments = useQuery({
    queryKey: ['payments'],
    queryFn: api.payments,
    enabled: !!returned && holdPending,
    refetchInterval: (q) =>
      q.state.data?.find((i) => i.id === returned)?.status === 'PENDING' ? 3_000 : false,
  });
  const returnedHold = payments.data?.find((i) => i.id === returned);
  useEffect(() => {
    if (returnedHold?.status === 'AUTHORIZED')
      void queryClient.invalidateQueries({ queryKey: ['stay'] });
  }, [returnedHold?.status, queryClient]);
  const [attemptKey] = useState(() => crypto.randomUUID());
  const hold = useMutation({
    mutationFn: () => api.hold(attemptKey),
    onSuccess: (intent) => {
      if (intent.status === 'AUTHORIZED')
        return queryClient.invalidateQueries({ queryKey: ['stay'] });
      if (intent.checkoutUrl) window.location.assign(intent.checkoutUrl);
    },
  });
  return (
    <SectionCard
      variant="badge"
      icon={KeyRound}
      title={t('checkIn.title')}
      description={s.verified ? t('checkIn.description') : t('checkIn.verifyFirst')}
    >
      <CardContent className="flex flex-col gap-3">
        {s.cardHold && (
          <div className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
            <span className="flex items-center justify-between gap-2">
              <span>
                {rich('checkIn.cardHold', {
                  amount: (
                    <strong>{formatMoney(s.cardHold.requiredMinor, s.cardHold.currency)}</strong>
                  ),
                })}
              </span>
              {s.cardHold.authorized && <Badge variant="success">{t('checkIn.authorized')}</Badge>}
            </span>
            {!s.cardHold.authorized && (
              <>
                <span className="text-muted-foreground">{t('checkIn.holdHint')}</span>
                {returnedHold?.status === 'FAILED' && <Alert>{t('checkIn.declined')}</Alert>}
                {hold.error && <Alert>{errorMessage(hold.error)}</Alert>}
                <Button
                  variant="outline"
                  onClick={() => hold.mutate()}
                  loading={hold.isPending || returnedHold?.status === 'PENDING'}
                  disabled={!s.verified}
                >
                  {!hold.isPending && <CreditCard />}
                  {t('checkIn.authorizeHold')}
                </Button>
              </>
            )}
          </div>
        )}
        {checkIn.error && <Alert>{errorMessage(checkIn.error)}</Alert>}
        <Button
          size="lg"
          onClick={() => checkIn.mutate()}
          loading={checkIn.isPending}
          disabled={!s.verified || holdPending}
        >
          {!checkIn.isPending && <DoorOpen />}
          {t('checkIn.now')}
        </Button>
      </CardContent>
    </SectionCard>
  );
}

export function RoomAccess({ result }: { result: SelfCheckInResult }) {
  return (
    <Card className="animate-scale-in border-success/30 bg-success/5">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="size-4" />
          </span>
          {t('checkIn.done', { room: result.roomNumber })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 rounded-xl border bg-card p-4 text-sm">
          <KeyRound className="size-5 shrink-0 text-primary" />
          <p>{result.access.instructions}</p>
        </div>
      </CardContent>
    </Card>
  );
}
