'use client';

import { Alert, Card, CardContent, CardHeader, CardTitle, Input, Notice } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';

/** Daily financial report and ledger reconciliation (blueprint §15). */
export default function ReportsPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const [date, setDate] = useState('');
  const report = useQuery({
    queryKey: ['daily-report', propertyId, date],
    queryFn: () => pms.dailyReport(date || undefined),
  });
  const reconciliation = useQuery({
    queryKey: ['reconciliation', propertyId],
    queryFn: pms.reconciliation,
  });
  const r = report.data;
  const money = (v: number) => formatMoney(v, r?.currency ?? 'PHP');

  const table = (
    title: string,
    rows: { label: string; value: number; count?: number }[],
    total: number,
  ) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        {rows.length === 0 && <span className="text-muted-foreground">—</span>}
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-2">
            <span>
              {row.label.toLowerCase().replace('_', ' ')}
              {row.count !== undefined && ` (${row.count})`}
            </span>
            <span className="tabular-nums">{money(row.value)}</span>
          </div>
        ))}
        <div className="flex justify-between gap-2 border-t pt-1 font-semibold">
          <span>{t('fin.total')}</span>
          <span className="tabular-nums">{money(total)}</span>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          {t('fin.reports')} {r && `· ${r.businessDate}`}
        </h1>
        <Input
          type="date"
          className="w-auto"
          aria-label={t('fin.businessDate')}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      {(report.error || reconciliation.error) && (
        <Alert>{errorMessage(report.error ?? reconciliation.error)}</Alert>
      )}
      {reconciliation.data &&
        (reconciliation.data.ok ? (
          <Notice>{t('fin.reconciled')}</Notice>
        ) : (
          <Alert>
            <div className="font-medium">{t('fin.reconciliationIssues')}</div>
            <ul className="mt-1 list-disc pl-5">
              {reconciliation.data.issues.map((i, n) => (
                <li key={n}>
                  {i.message} <span className="font-mono text-xs">{i.reference}</span>
                </li>
              ))}
            </ul>
          </Alert>
        ))}
      {r && (
        <div className="grid gap-4 md:grid-cols-2">
          {table(
            t('fin.revenue'),
            r.revenue.map((x) => ({ label: x.department, value: x.netMinor })),
            r.totals.revenueNetMinor,
          )}
          {table(
            t('fin.taxes'),
            r.taxes.map((x) => ({ label: x.code, value: x.amountMinor })),
            r.totals.taxMinor,
          )}
          {table(
            t('fin.payments'),
            r.payments.map((x) => ({ label: x.method, value: x.amountMinor, count: x.count })),
            r.totals.paymentsMinor,
          )}
          {table(
            t('fin.refunds'),
            r.refunds.map((x) => ({ label: x.method, value: x.amountMinor, count: x.count })),
            r.totals.refundsMinor,
          )}
          <Notice>
            {t('fin.outstanding')}: {money(r.outstandingMinor)}
          </Notice>
        </div>
      )}
    </div>
  );
}
