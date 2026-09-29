'use client';

import type { Folio } from '@hotel/contracts';
import { currencyDigits, formatMoney, minorToInput, parseMoney } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Notice,
  NativeSelect,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';

function useSetFolio(propertyId: string, folioId: string) {
  const queryClient = useQueryClient();
  return (data: Folio) => queryClient.setQueryData(['folio', propertyId, folioId], data);
}

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

/** Senior citizen / PWD discount on the folio: the holder's ID is stored encrypted. */
export function StatutoryDiscount({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const pms = usePms(propertyId);
  const setFolio = useSetFolio(propertyId, folio.id);
  const profiles = useQuery({
    queryKey: ['discount-profiles', propertyId],
    queryFn: pms.discountProfiles,
  });
  const active = (profiles.data ?? []).filter((p) => p.active);
  const [profileId, setProfileId] = useState('');
  const [holderName, setHolderName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const chosen = profileId || active[0]?.id || '';
  const change = useMutation({
    mutationFn: (fn: () => Promise<Folio>) => fn(),
    onSuccess: (data) => {
      setHolderName('');
      setIdNumber('');
      setFolio(data);
    },
  });
  if (!folio.discount && active.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.discount')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {folio.discount ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <Badge variant="success">{folio.discount.name}</Badge> {folio.discount.holderName} ·
              ID ••••{folio.discount.idLast4}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={change.isPending}
              onClick={() => change.mutate(() => pms.removeDiscount(folio.id))}
            >
              {t('fin.remove')}
            </Button>
          </div>
        ) : (
          <form
            className="grid gap-2 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate(() =>
                pms.applyDiscount(folio.id, {
                  profileId: chosen,
                  holderName: holderName.trim(),
                  idNumber: idNumber.trim(),
                }),
              );
            }}
          >
            <NativeSelect
              aria-label={t('fin.discount')}
              value={chosen}
              onChange={(e) => setProfileId(e.target.value)}
            >
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.discountPercent}%)
                </option>
              ))}
            </NativeSelect>
            <Input
              required
              aria-label={t('fin.discountHolder')}
              placeholder={t('fin.discountHolder')}
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
            />
            <Input
              required
              autoComplete="off"
              aria-label={t('fin.discountId')}
              placeholder={t('fin.discountId')}
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
            />
            <Button type="submit" variant="outline" loading={change.isPending}>
              {t('fin.applyDiscount')}
            </Button>
            <p className="text-xs text-muted-foreground sm:col-span-4">{t('fin.discountNote')}</p>
          </form>
        )}
        {change.error && <Alert>{errorMessage(change.error)}</Alert>}
      </CardContent>
    </Card>
  );
}

/** Card holds on the stay: capture onto this folio at check-out, or release. */
export function CardHolds({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const intents = useQuery({
    queryKey: ['intents', propertyId, folio.id],
    queryFn: () => pms.paymentIntents(folio.id),
  });
  const holds = (intents.data ?? []).filter((i) => i.kind === 'HOLD');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['intents', propertyId, folio.id] }),
        queryClient.invalidateQueries({ queryKey: ['folio', propertyId, folio.id] }),
      ]),
  });
  if (holds.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.holds')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {holds.map((h) => {
          const defaultAmount = Math.min(h.amountMinor, Math.max(folio.balanceMinor, 0));
          const value =
            amounts[h.id] ?? (defaultAmount > 0 ? minorToInput(defaultAmount, h.currency) : '');
          const minor = parseMoney(value, h.currency);
          return (
            <div
              key={h.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
            >
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{formatMoney(h.amountMinor, h.currency)}</span>
                <Badge>{h.status.toLowerCase()}</Badge>
                {h.capturedMinor > 0 && (
                  <span className="text-muted-foreground">
                    {formatMoney(h.capturedMinor, h.currency)} {t('fin.captured')}
                  </span>
                )}
              </span>
              {h.status === 'AUTHORIZED' && folio.status === 'OPEN' && (
                <span className="flex flex-wrap items-center gap-2">
                  <Input
                    className="w-28"
                    inputMode="decimal"
                    aria-label={t('folio.amount')}
                    value={value}
                    onChange={(e) => setAmounts({ ...amounts, [h.id]: e.target.value })}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!minor || minor > h.amountMinor || act.isPending}
                    onClick={() =>
                      act.mutate(() => pms.captureHold(h.id, minor!, crypto.randomUUID()))
                    }
                  >
                    {t('fin.capture')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={act.isPending}
                    onClick={() => act.mutate(() => pms.releaseHold(h.id))}
                  >
                    {t('fin.release')}
                  </Button>
                </span>
              )}
            </div>
          );
        })}
        {act.error && <Alert>{errorMessage(act.error)}</Alert>}
      </CardContent>
    </Card>
  );
}
