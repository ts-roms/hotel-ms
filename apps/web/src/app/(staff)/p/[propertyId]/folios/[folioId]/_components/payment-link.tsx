'use client';

import { type Folio } from '@hotel/contracts';
import { formatMoney, minorToInput, parseMoney } from '@hotel/format';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';

export function PaymentLink({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const pms = usePms(propertyId);
  const [amount, setAmount] = useState(
    folio.balanceMinor > 0 ? minorToInput(folio.balanceMinor, folio.currency) : '',
  );
  const intents = useQuery({
    queryKey: ['intents', propertyId, folio.id],
    queryFn: () => pms.paymentIntents(folio.id),
    refetchInterval: 15_000,
  });
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () =>
      pms.paymentLink(folio.id, parseMoney(amount, folio.currency)!, crypto.randomUUID()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['intents', propertyId, folio.id] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.onlinePayment')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap gap-2">
          <Input
            className="w-32"
            inputMode="decimal"
            aria-label={t('folio.amount')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={!parseMoney(amount, folio.currency) || create.isPending}
            onClick={() => create.mutate()}
          >
            {t('fin.createLink')}
          </Button>
        </div>
        {create.error && <Alert>{errorMessage(create.error)}</Alert>}
        {intents.data
          ?.filter((i) => i.kind === 'PAYMENT')
          .slice(0, 5)
          .map((i) => (
            <div
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
            >
              <span className="tabular-nums">{formatMoney(i.amountMinor, i.currency)}</span>
              <span className="flex items-center gap-2">
                <Badge className={i.needsAttention ? 'text-destructive' : ''}>
                  {i.status.toLowerCase()}
                  {i.needsAttention && ` · ${t('fin.needsAttention')}`}
                </Badge>
                {i.checkoutUrl && (
                  <>
                    <a className="underline" href={i.checkoutUrl} target="_blank" rel="noreferrer">
                      {t('fin.openLink')}
                    </a>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void navigator.clipboard.writeText(i.checkoutUrl!)}
                    >
                      {t('fin.copyLink')}
                    </Button>
                  </>
                )}
              </span>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
