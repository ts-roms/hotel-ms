'use client';

import { formatMoney, minorToInput, parseMoney } from '@hotel/format';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useProperty } from '@/lib/property';

export function HoldSettings({
  propertyId,
  canManage,
}: {
  propertyId: string;
  canManage: boolean;
}) {
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
