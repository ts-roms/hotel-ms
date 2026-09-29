'use client';

import { type Folio } from '@hotel/contracts';
import { formatMoney, minorToInput, parseMoney } from '@hotel/format';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';
import { useRefreshFolio } from './folio-cache';

export function FolioPayments({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const pms = usePms(propertyId);
  const session = useSession();
  const refresh = useRefreshFolio(propertyId, folio.id);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const refund = useMutation({
    mutationFn: (paymentId: string) =>
      pms.refund(paymentId, parseMoney(amount, folio.currency)!, reason, crypto.randomUUID()),
    onSuccess: () => {
      setRefunding(null);
      setAmount('');
      setReason('');
      return refresh();
    },
  });
  const canRefund = hasPermission(session.data, 'payment.refund') && folio.status === 'OPEN';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.payments')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {refund.error && <Alert>{errorMessage(refund.error)}</Alert>}
        {folio.payments.map((p) => {
          const left = p.amountMinor - p.refundedMinor;
          return (
            <div key={p.id} className="flex flex-col gap-2 border-t pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {p.method.replace('_', ' ').toLowerCase()}
                  {p.provider && <Badge className="ml-2">{t('fin.online')}</Badge>}
                  {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                  {p.tendered && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {formatMoney(p.tendered.amountMinor, p.tendered.currency)} @{' '}
                      {p.tendered.rate}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatMoney(p.amountMinor, folio.currency)}</span>
                  {p.refundedMinor > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t('fin.refunded')} {formatMoney(p.refundedMinor, folio.currency)}
                    </span>
                  )}
                  {canRefund && left > 0 && refunding !== p.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRefunding(p.id);
                        setAmount(minorToInput(left, folio.currency));
                      }}
                    >
                      {t('fin.refund')}
                    </Button>
                  )}
                </span>
              </div>
              {refunding === p.id && (
                <div className="flex flex-wrap gap-2">
                  <Input
                    className="w-28"
                    inputMode="decimal"
                    aria-label={t('folio.amount')}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <Input
                    className="min-w-40 flex-1"
                    placeholder={t('fin.reason')}
                    aria-label={t('fin.reason')}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={
                      !parseMoney(amount, folio.currency) ||
                      reason.trim().length < 3 ||
                      refund.isPending
                    }
                    onClick={() => refund.mutate(p.id)}
                  >
                    {t('fin.refund')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRefunding(null)}>
                    {t('fin.cancel')}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
