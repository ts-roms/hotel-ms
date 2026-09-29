'use client';

import { formatDateTime, formatMoney, parseMoney } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useProperty, usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

/** The cashier's drawer (blueprint §15.2): open with a float, close with a count. */
export default function CashierPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const property = useProperty(propertyId);
  const currency = property.data?.currency ?? 'PHP';
  const queryClient = useQueryClient();
  const shift = useQuery({ queryKey: ['cashier', propertyId], queryFn: pms.cashierShift });
  const history = useQuery({
    queryKey: ['cashier-shifts', propertyId],
    queryFn: pms.cashierShifts,
    enabled: hasPermission(session.data, 'finance.report.read'),
  });
  const refresh = () =>
    queryClient
      .invalidateQueries({ queryKey: ['cashier'] })
      .then(() => queryClient.invalidateQueries({ queryKey: ['cashier-shifts', propertyId] }));
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const minor = parseMoney(amount, currency);
  const open = useMutation({
    mutationFn: () => pms.openCashierShift(minor ?? 0),
    onSuccess: () => {
      setAmount('');
      return refresh();
    },
  });
  const close = useMutation({
    mutationFn: () => pms.closeCashierShift(shift.data!.id, shift.data!.version, minor ?? 0, notes),
    onSuccess: () => {
      setAmount('');
      setNotes('');
      return refresh();
    },
  });
  const s = shift.data;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('fin.cashier')}</h1>
      {(shift.error || open.error || close.error) && (
        <Alert>{errorMessage(shift.error ?? open.error ?? close.error)}</Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{s ? t('fin.shiftOpen') : t('fin.noShift')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {s && (
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              <span>
                {t('fin.float')}: {formatMoney(s.openingFloatMinor, currency)}
              </span>
              <span>
                {t('fin.cashIn')}: {formatMoney(s.cashInMinor, currency)}
              </span>
              <span>
                {t('fin.cashOut')}: {formatMoney(s.cashOutMinor, currency)}
              </span>
              <strong>
                {t('fin.expected')}: {formatMoney(s.expectedCashMinor, currency)}
              </strong>
              {s.foreignCash.length > 0 && (
                <span className="col-span-2 text-muted-foreground sm:col-span-4">
                  {t('fin.foreignNotes')}:{' '}
                  {s.foreignCash.map((c) => formatMoney(c.amountMinor, c.currency)).join(' · ')}
                </span>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-36"
              inputMode="decimal"
              placeholder={s ? t('fin.counted') : t('fin.float')}
              aria-label={s ? t('fin.counted') : t('fin.float')}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {s && (
              <Input
                className="min-w-40 flex-1"
                placeholder={t('fin.notes')}
                aria-label={t('fin.notes')}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
            {s ? (
              <Button disabled={minor === null || close.isPending} onClick={() => close.mutate()}>
                {t('fin.closeShift')}
              </Button>
            ) : (
              <Button disabled={minor === null || open.isPending} onClick={() => open.mutate()}>
                {t('fin.openShift')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {history.data && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('fin.cashierName')}</TableHead>
              <TableHead>{t('fin.opened')}</TableHead>
              <TableHead>{t('fin.status')}</TableHead>
              <TableHead className="text-right">{t('fin.expected')}</TableHead>
              <TableHead className="text-right">{t('fin.counted')}</TableHead>
              <TableHead className="text-right">{t('fin.variance')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.data.map((h) => (
              <TableRow key={h.id}>
                <TableCell>{h.cashierName}</TableCell>
                <TableCell>{formatDateTime(h.openedAt)}</TableCell>
                <TableCell>
                  <Badge>{h.status.toLowerCase()}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(h.expectedCashMinor, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {h.countedCashMinor === null ? '—' : formatMoney(h.countedCashMinor, currency)}
                </TableCell>
                <TableCell
                  className={cn('text-right tabular-nums', h.varianceMinor && 'text-destructive')}
                >
                  {h.varianceMinor === null ? '—' : formatMoney(h.varianceMinor, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
