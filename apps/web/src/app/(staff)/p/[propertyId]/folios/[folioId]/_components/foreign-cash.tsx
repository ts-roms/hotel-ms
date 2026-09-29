'use client';

import type { Folio } from '@hotel/contracts';
import { currencyDigits, formatMoney, parseMoney } from '@hotel/format';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Notice,
  NativeSelect,
} from '@hotel/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { useSetFolio } from './folio-cache';

/** Foreign notes at the desk, converted at the property's current rate (ADR-0018). */
export function ForeignCash({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const pms = usePms(propertyId);
  const setFolio = useSetFolio(propertyId, folio.id);
  const rates = useQuery({ queryKey: ['exchange-rates', propertyId], queryFn: pms.exchangeRates });
  // The API lists the newest rate of each currency first.
  const latest = new Map<string, string>();
  for (const r of rates.data ?? []) if (!latest.has(r.currency)) latest.set(r.currency, r.rate);
  const currencies = [...latest.keys()];
  const [currency, setCurrency] = useState('');
  const [amount, setAmount] = useState('');
  const chosen = currency || currencies[0] || '';
  const tenderedMinor = chosen ? parseMoney(amount, chosen) : null;
  const preview =
    tenderedMinor && latest.get(chosen)
      ? Math.round(
          (tenderedMinor / 10 ** currencyDigits(chosen)) *
            Number(latest.get(chosen)) *
            10 ** currencyDigits(folio.currency),
        )
      : null;
  const pay = useMutation({
    mutationFn: () =>
      pms.recordPayment(
        folio.id,
        {
          method: 'CASH',
          tendered: { currency: chosen, amountMinor: tenderedMinor! },
          reference: null,
        },
        crypto.randomUUID(),
      ),
    onSuccess: (data) => {
      setAmount('');
      setFolio(data);
    },
  });
  if (rates.isPending) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.foreignCash')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {currencies.length === 0 ? (
          <Notice>{t('fin.noRates')}</Notice>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              className="w-40"
              aria-label={t('fin.currency')}
              value={chosen}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c} @ {latest.get(c)}
                </option>
              ))}
            </NativeSelect>
            <Input
              className="w-32"
              inputMode="decimal"
              aria-label={t('folio.amount')}
              placeholder={t('folio.amount')}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {preview !== null && (
              <span className="text-muted-foreground">
                {t('fin.convertsTo')} ≈ {formatMoney(preview, folio.currency)}
              </span>
            )}
            <Button
              variant="outline"
              disabled={!tenderedMinor || pay.isPending}
              onClick={() => pay.mutate()}
            >
              {t('fin.takeCash')}
            </Button>
          </div>
        )}
        {pay.error && <Alert>{errorMessage(pay.error)}</Alert>}
      </CardContent>
    </Card>
  );
}
