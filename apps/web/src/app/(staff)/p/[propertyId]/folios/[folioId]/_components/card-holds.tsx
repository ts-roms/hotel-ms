'use client';

import type { Folio } from '@hotel/contracts';
import { formatMoney, minorToInput, parseMoney } from '@hotel/format';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { statusLabel } from '@/lib/status';

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
                <Badge>{statusLabel(h.status)}</Badge>
                {h.capturedMinor > 0 && (
                  <span className="text-muted-foreground">
                    {t('fin.capturedAmount', { amount: formatMoney(h.capturedMinor, h.currency) })}
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
