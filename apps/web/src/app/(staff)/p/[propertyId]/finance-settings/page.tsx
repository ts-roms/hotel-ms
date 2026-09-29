'use client';

import { DEPARTMENTS } from '@hotel/contracts';
import { formatDateTime, formatMoney, minorToInput, parseMoney } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Notice,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useProperty, usePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

/** Exchange rates, statutory discount profiles and the self check-in card hold (ADR-0018). */
export default function FinanceSettingsPage() {
  const propertyId = usePropertyId();
  const session = useSession();
  const can = (p: string) => hasPermission(session.data, p);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('nav.financeSettings')}</h1>
      <ExchangeRates propertyId={propertyId} canManage={can('exchange_rate.manage')} />
      <DiscountProfiles propertyId={propertyId} canManage={can('tax.manage')} />
      <HoldSettings propertyId={propertyId} canManage={can('property.settings.manage')} />
    </div>
  );
}

function ExchangeRates({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
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
              <span>{formatDateTime(r.effectiveFrom)}</span>
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

function DiscountProfiles({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const profiles = useQuery({
    queryKey: ['discount-profiles', propertyId],
    queryFn: pms.discountProfiles,
  });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [percent, setPercent] = useState('20');
  const [exempt, setExempt] = useState('VAT');
  const [departments, setDepartments] = useState<string[]>(['ROOM', 'FNB']);
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discount-profiles', propertyId] }),
  });
  const create = () =>
    act.mutate(async () => {
      await pms.createDiscountProfile({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        discountPercent: Number(percent),
        exemptTaxCodes: exempt
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
        departments: departments as (typeof DEPARTMENTS)[number][],
      });
      setCode('');
      setName('');
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.discountProfiles')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {profiles.data?.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
          >
            <span className={p.active ? '' : 'text-muted-foreground'}>
              <strong>{p.code}</strong> {p.name} · {p.discountPercent}%
              {p.exemptTaxCodes.length > 0 && ` · ${p.exemptTaxCodes.join(', ')}-exempt`} ·{' '}
              {p.departments.join(', ').toLowerCase()}
              {!p.active && <Badge className="ml-2">{t('fin.archived')}</Badge>}
            </span>
            {canManage && p.active && (
              <Button
                size="sm"
                variant="ghost"
                disabled={act.isPending}
                onClick={() => act.mutate(() => pms.archiveDiscountProfile(p.id))}
              >
                {t('fin.archive')}
              </Button>
            )}
          </div>
        ))}
        {canManage && (
          <form
            className="grid gap-2 border-t pt-2 sm:grid-cols-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              create();
            }}
          >
            <Input
              required
              aria-label={t('fin.code')}
              placeholder={t('fin.code')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Input
              required
              aria-label={t('fin.name')}
              placeholder={t('fin.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              required
              inputMode="decimal"
              aria-label={t('fin.discountPercent')}
              placeholder={t('fin.discountPercent')}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
            <Input
              aria-label={t('fin.exemptTaxes')}
              placeholder={t('fin.exemptTaxes')}
              value={exempt}
              onChange={(e) => setExempt(e.target.value)}
            />
            <fieldset className="flex flex-wrap gap-3 sm:col-span-3">
              <legend className="sr-only">{t('fin.departments')}</legend>
              {DEPARTMENTS.map((d) => (
                <Label key={d} className="flex items-center gap-1 font-normal">
                  <Checkbox
                    checked={departments.includes(d)}
                    onCheckedChange={(v) =>
                      setDepartments(
                        v === true ? [...departments, d] : departments.filter((x) => x !== d),
                      )
                    }
                  />
                  {d.toLowerCase()}
                </Label>
              ))}
            </fieldset>
            <Button type="submit" variant="outline" loading={act.isPending}>
              {t('fin.addProfile')}
            </Button>
          </form>
        )}
        {act.error && <Alert>{errorMessage(act.error)}</Alert>}
      </CardContent>
    </Card>
  );
}

function HoldSettings({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const pms = usePms(propertyId);
  const property = useProperty(propertyId);
  const currency = property.data?.currency ?? 'PHP';
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['payment-settings', propertyId],
    queryFn: pms.paymentSettings,
  });
  const [amount, setAmount] = useState<string | null>(null);
  const value =
    amount ?? (settings.data ? minorToInput(settings.data.selfCheckInHoldMinor, currency) : '');
  const minor = value.trim() === '' ? null : parseMoney(value, currency);
  const save = useMutation({
    mutationFn: () => pms.updatePaymentSettings({ selfCheckInHoldMinor: minor ?? 0 }),
    onSuccess: (data) => {
      setAmount(null);
      queryClient.setQueryData(['payment-settings', propertyId], data);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.paymentSettings')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">{t('fin.holdHint')}</p>
        {canManage ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Input
              className="w-40"
              inputMode="decimal"
              aria-label={t('fin.holdAmount')}
              placeholder={t('fin.holdAmount')}
              value={value}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              loading={save.isPending}
              disabled={minor === null && value.trim() !== ''}
            >
              {t('fin.save')}
            </Button>
            {save.isSuccess && <span className="self-center">{t('fin.saved')}</span>}
          </form>
        ) : (
          settings.data && <span>{formatMoney(settings.data.selfCheckInHoldMinor, currency)}</span>
        )}
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
      </CardContent>
    </Card>
  );
}
