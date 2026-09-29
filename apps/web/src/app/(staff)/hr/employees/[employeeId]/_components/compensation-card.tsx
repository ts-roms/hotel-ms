'use client';

import { PAY_BASES } from '@hotel/contracts';
import { formatDate, formatMoney, parseMoney } from '@hotel/format';
import { Alert, Button, Input, NativeSelect } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { today } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { RecordSection } from './record-section';

/** Pay history (employee.compensation, two-step verification). */
export function CompensationCard({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const pay = useQuery({
    queryKey: ['compensation', employeeId],
    queryFn: () => api.hr.compensation(employeeId),
    retry: false,
  });
  const [form, setForm] = useState({
    effectiveFrom: today(),
    payBasis: 'MONTHLY' as (typeof PAY_BASES)[number],
    amount: '',
    currency: 'PHP',
    notes: '',
  });
  const amountMinor = parseMoney(form.amount, form.currency);
  const add = useMutation({
    mutationFn: () =>
      api.hr.addCompensation(employeeId, {
        effectiveFrom: form.effectiveFrom,
        payBasis: form.payBasis,
        amountMinor: amountMinor ?? 0,
        currency: form.currency,
        notes: form.notes,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['compensation', employeeId], data);
      setForm({ ...form, amount: '', notes: '' });
    },
  });
  const per = (basis: string) => t(`hrx.per.${basis}` as 'hrx.per.MONTHLY');

  return (
    <RecordSection icon={<Banknote />} title={t('hrx.pay')}>
      {pay.error && <Alert>{errorMessage(pay.error)}</Alert>}
      {pay.data && (
        <>
          <p>
            {t('hrx.currentPay')}:{' '}
            {pay.data.current ? (
              <strong className="tabular-nums">
                {formatMoney(pay.data.current.amountMinor, pay.data.current.currency)}{' '}
                {per(pay.data.current.payBasis)}
              </strong>
            ) : (
              <span className="text-muted-foreground">{t('hrx.none')}</span>
            )}
          </p>
          {pay.data.history.map((c) => (
            <div
              key={c.id}
              className="flex justify-between gap-2 border-t pt-2 text-muted-foreground"
            >
              <span>
                {t('hrx.from')} {formatDate(c.effectiveFrom)}
                {c.notes && ` · ${c.notes}`}
                {c.createdByName && ` · ${c.createdByName}`}
              </span>
              <span className="tabular-nums">
                {formatMoney(c.amountMinor, c.currency)} {per(c.payBasis)}
              </span>
            </div>
          ))}
          <form
            className="flex flex-wrap items-center gap-2 border-t pt-3"
            onSubmit={(ev: FormEvent) => {
              ev.preventDefault();
              add.mutate();
            }}
          >
            <Input
              type="date"
              className="w-auto"
              aria-label={t('hrx.effectiveFrom')}
              value={form.effectiveFrom}
              onChange={(ev) => setForm({ ...form, effectiveFrom: ev.target.value })}
            />
            <Input
              className="w-32"
              inputMode="decimal"
              aria-label={t('hrx.amount')}
              placeholder={t('hrx.amount')}
              value={form.amount}
              onChange={(ev) => setForm({ ...form, amount: ev.target.value })}
            />
            <Input
              className="w-20"
              maxLength={3}
              aria-label={t('fin.currency')}
              value={form.currency}
              onChange={(ev) => setForm({ ...form, currency: ev.target.value.toUpperCase() })}
            />
            <NativeSelect
              className="w-auto"
              aria-label={t('hrx.payBasis')}
              value={form.payBasis}
              onChange={(ev) =>
                setForm({ ...form, payBasis: ev.target.value as (typeof PAY_BASES)[number] })
              }
            >
              {PAY_BASES.map((b) => (
                <option key={b} value={b}>
                  {per(b)}
                </option>
              ))}
            </NativeSelect>
            <Input
              className="min-w-40 flex-1"
              aria-label={t('hr.note')}
              placeholder={t('hr.note')}
              maxLength={500}
              value={form.notes}
              onChange={(ev) => setForm({ ...form, notes: ev.target.value })}
            />
            <Button
              type="submit"
              variant="outline"
              loading={add.isPending}
              disabled={amountMinor === null || !form.effectiveFrom}
            >
              {t('hrx.recordPay')}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">{t('hrx.payHint')}</p>
          {add.error && <Alert>{errorMessage(add.error)}</Alert>}
        </>
      )}
    </RecordSection>
  );
}
