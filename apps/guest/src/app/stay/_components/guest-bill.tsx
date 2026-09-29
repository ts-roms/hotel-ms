'use client';

import { formatDate, formatMoney } from '@hotel/format';
import { Alert, Button, CardContent, cn, Notice, SkeletonCard } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Section } from '@/components/section';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';

export function GuestBill() {
  const bill = useQuery({ queryKey: ['bill'], queryFn: api.bill });
  // Back from the hosted checkout: ?payment=<intent id>.
  const [returned] = useState(() =>
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('payment'),
  );
  const payments = useQuery({
    queryKey: ['payments'],
    queryFn: api.payments,
    enabled: !!returned,
    refetchInterval: (q) =>
      q.state.data?.find((i) => i.id === returned)?.status === 'PENDING' ? 3_000 : false,
  });
  const outcome = payments.data?.find((i) => i.id === returned);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (outcome?.status === 'SUCCEEDED') void queryClient.invalidateQueries({ queryKey: ['bill'] });
  }, [outcome?.status, queryClient]);
  const [attemptKey] = useState(() => crypto.randomUUID());
  const pay = useMutation({
    mutationFn: () => api.pay(undefined, attemptKey),
    onSuccess: (intent) => {
      if (intent.checkoutUrl) window.location.assign(intent.checkoutUrl);
    },
  });
  if (bill.isPending) return <SkeletonCard lines={3} />;
  if (!bill.data) return null;
  const { currency, lines, balanceMinor } = bill.data;
  return (
    <Section icon={<Receipt />} title={t('bill.title')}>
      <CardContent className="flex flex-col text-sm">
        {lines.length === 0 && (
          <p className="rounded-xl border border-dashed py-6 text-center text-muted-foreground">
            {t('bill.empty')}
          </p>
        )}
        {lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-3 border-b py-2.5 last:border-0">
            <span className="flex flex-col">
              <span>{l.description}</span>
              <span className="text-xs text-muted-foreground">{formatDate(l.date)}</span>
            </span>
            <span className={cn('font-medium tabular-nums', l.amountMinor < 0 && 'text-success')}>
              {formatMoney(l.amountMinor, currency)}
            </span>
          </div>
        ))}
        <div className="mt-3 flex items-center justify-between rounded-xl bg-muted/60 px-4 py-3">
          <span className="font-medium">{t('bill.balance')}</span>
          <span
            className={cn(
              'text-lg font-semibold tabular-nums',
              balanceMinor <= 0 && 'text-success',
            )}
          >
            {formatMoney(balanceMinor, currency)}
          </span>
        </div>
        {outcome?.status === 'SUCCEEDED' && <Notice>{t('bill.paid')}</Notice>}
        {outcome?.status === 'FAILED' && <Alert>{t('bill.failed')}</Alert>}
        {pay.error && <Alert>{errorMessage(pay.error)}</Alert>}
        {balanceMinor > 0 && (
          <Button disabled={pay.isPending} onClick={() => pay.mutate()}>
            {t('bill.pay', { amount: formatMoney(balanceMinor, currency) })}
          </Button>
        )}
      </CardContent>
    </Section>
  );
}
