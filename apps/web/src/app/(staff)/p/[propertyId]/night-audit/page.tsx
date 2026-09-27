'use client';

import type { FrontDeskItem } from '@hotel/contracts';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';

export default function NightAuditPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['night-audit', propertyId],
    queryFn: pms.nightAuditPreview,
  });
  const history = useQuery({ queryKey: ['business-days', propertyId], queryFn: pms.businessDays });
  const run = useMutation({
    mutationFn: (businessDate: string) => pms.runNightAudit(businessDate),
    onSuccess: () =>
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes(propertyId) }),
  });

  const list = (items: FrontDeskItem[]) => (
    <ul className="flex flex-col gap-1 text-sm">
      {items.map((i) => (
        <li key={i.reservationRoomId}>
          {i.confirmationNo} · {i.guest.lastName}, {i.guest.firstName} ·{' '}
          {i.room?.number ?? i.roomTypeCode}
        </li>
      ))}
    </ul>
  );

  const p = preview.data;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('na.title')}</h1>
      {(preview.error || run.error) && <Alert>{errorMessage(preview.error ?? run.error)}</Alert>}
      {p && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t('na.closing')}: {formatDate(p.businessDate)}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm">
              {t('na.inHouse')}: <strong>{p.inHouseCount}</strong>
            </p>
            {p.pendingDepartures.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-destructive">{t('na.pending')}</span>
                {list(p.pendingDepartures)}
              </div>
            )}
            {p.expectedNoShows.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t('na.noShows')}</span>
                {list(p.expectedNoShows)}
              </div>
            )}
            <Button
              className="self-start"
              disabled={!p.canRun || run.isPending}
              onClick={() => run.mutate(p.businessDate)}
            >
              {t('na.run')}
            </Button>
          </CardContent>
        </Card>
      )}

      {history.data && history.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('na.history')}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="p-1">{t('res.businessDate')}</th>
                  <th className="p-1 text-right">{t('na.occupancy')}</th>
                  <th className="p-1 text-right">{t('na.revenue')}</th>
                  <th className="p-1 text-right">{t('na.adr')}</th>
                  <th className="p-1 text-right">{t('na.revpar')}</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((d) => (
                  <tr key={d.businessDate} className="border-t">
                    <td className="p-1">{formatDate(d.businessDate)}</td>
                    <td className="p-1 text-right">
                      {d.stats.occupancyPct}% ({d.stats.roomsSold}/{d.stats.roomsAvailable})
                    </td>
                    <td className="p-1 text-right">
                      {formatMoney(d.stats.roomRevenueMinor, d.stats.currency)}
                    </td>
                    <td className="p-1 text-right">
                      {formatMoney(d.stats.adrMinor, d.stats.currency)}
                    </td>
                    <td className="p-1 text-right">
                      {formatMoney(d.stats.revparMinor, d.stats.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
