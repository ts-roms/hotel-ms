'use client';

import { formatDateTime } from '@hotel/format';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Notice } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useProperty, usePropertyTimeZone } from '@/lib/property';

export function ExchangeRates({
  propertyId,
  canManage,
}: {
  propertyId: string;
  canManage: boolean;
}) {
  const timeZone = usePropertyTimeZone();
  const pms = usePms(propertyId);
  const property = useProperty(propertyId);
  const queryClient = useQueryClient();
  const rates = useQuery({ queryKey: ['exchange-rates', propertyId], queryFn: pms.exchangeRates });
  const [currency, setCurrency] = useState('USD');
  const [rate, setRate] = useState('');
  const set = useMutation({
    mutationFn: () => pms.setExchangeRate(currency.trim().toUpperCase(), rate.trim()),
    onSuccess: () => {
      setRate('');
      return queryClient.invalidateQueries({ queryKey: ['exchange-rates', propertyId] });
    },
  });
  const seen = new Set<string>();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.exchangeRates')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {rates.error && <Alert>{errorMessage(rates.error)}</Alert>}
        {rates.data?.length === 0 && <Notice>{t('fin.noRatesYet')}</Notice>}
        {rates.data?.map((r) => {
          const current = !seen.has(r.currency);
          seen.add(r.currency);
          return (
            <div
              key={r.id}
              className={`flex justify-between gap-2 border-t pt-2 ${current ? '' : 'text-muted-foreground'}`}
            >
              <span>
                1 {r.currency} = {r.rate} {property.data?.currency ?? ''}
              </span>
              <span>{formatDateTime(r.effectiveFrom, { timeZone })}</span>
            </div>
          );
        })}
        {canManage && (
          <form
            className="flex flex-wrap gap-2 border-t pt-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              set.mutate();
            }}
          >
            <Input
              className="w-24"
              maxLength={3}
              aria-label={t('fin.currency')}
              placeholder={t('fin.currency')}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />
            <Input
              className="w-40"
              inputMode="decimal"
              aria-label={t('fin.rate')}
              placeholder={t('fin.rateHint')}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
            <Button type="submit" variant="outline" loading={set.isPending} disabled={!rate}>
              {t('fin.setRate')}
            </Button>
          </form>
        )}
        <p className="text-xs text-muted-foreground">{t('fin.rateHistory')}</p>
        {set.error && <Alert>{errorMessage(set.error)}</Alert>}
      </CardContent>
    </Card>
  );
}
