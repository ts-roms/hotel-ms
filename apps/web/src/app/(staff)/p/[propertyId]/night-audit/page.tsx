'use client';

import type { FrontDeskItem } from '@hotel/contracts';
import { formatDate, formatMoney } from '@hotel/format';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  LoadingRegion,
  PageHeader,
  Skeleton,
  SkeletonCard,
  SkeletonTable,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, CalendarDays, MoonStar, TriangleAlert, UserX } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
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
    <ul className="flex flex-col divide-y rounded-lg border text-sm">
      {items.map((i) => (
        <li key={i.reservationRoomId} className="flex flex-wrap gap-x-2 px-3 py-2">
          <span className="font-mono text-xs text-muted-foreground">{i.confirmationNo}</span>
          <span className="font-medium">
            {i.guest.lastName}, {i.guest.firstName}
          </span>
          <span className="ml-auto text-muted-foreground">{i.room?.number ?? i.roomTypeCode}</span>
        </li>
      ))}
    </ul>
  );

  const p = preview.data;
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('na.title')} />
      {(preview.error || run.error) && <Alert>{errorMessage(preview.error ?? run.error)}</Alert>}

      {preview.isPending && (
        <LoadingRegion label={t('loading')} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="flex items-center gap-4 p-5">
              <Skeleton className="size-11 rounded-xl" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-16" />
              </div>
            </Card>
            <Card className="flex items-center gap-4 p-5">
              <Skeleton className="size-11 rounded-xl" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-16" />
              </div>
            </Card>
          </div>
          <SkeletonCard lines={2} />
        </LoadingRegion>
      )}

      {p && (
        <div className="stagger flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label={t('na.closing')}
              value={formatDate(p.businessDate)}
              icon={<CalendarDays />}
            />
            <StatCard
              label={t('na.inHouse')}
              value={p.inHouseCount}
              icon={<BedDouble />}
              tone="success"
            />
          </div>
          <Card>
            <CardContent className="flex flex-col gap-5 pt-6">
              {p.pendingDepartures.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <TriangleAlert className="size-4" />
                    {t('na.pending')}
                  </span>
                  {list(p.pendingDepartures)}
                </div>
              )}
              {p.expectedNoShows.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-warning">
                    <UserX className="size-4" />
                    {t('na.noShows')}
                  </span>
                  {list(p.expectedNoShows)}
                </div>
              )}
              <Button
                size="lg"
                className="self-start"
                loading={run.isPending}
                disabled={!p.canRun}
                onClick={() => run.mutate(p.businessDate)}
              >
                {!run.isPending && <MoonStar />}
                {t('na.run')}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="text-base">{t('na.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.isPending && (
            <LoadingRegion label={t('loading')}>
              <SkeletonTable rows={4} columns={5} />
            </LoadingRegion>
          )}
          {history.data?.length === 0 && (
            <EmptyState icon={<MoonStar />} title={t('na.noHistory')} className="border-0" />
          )}
          {history.data && history.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2">{t('res.businessDate')}</TableHead>
                  <TableHead className="px-2 text-right">{t('na.occupancy')}</TableHead>
                  <TableHead className="px-2 text-right">{t('na.revenue')}</TableHead>
                  <TableHead className="px-2 text-right">{t('na.adr')}</TableHead>
                  <TableHead className="px-2 text-right">{t('na.revpar')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="stagger">
                {history.data.map((d) => (
                  <TableRow key={d.businessDate}>
                    <TableCell className="px-2 py-3 font-medium">
                      {formatDate(d.businessDate)}
                    </TableCell>
                    <TableCell className="px-2 py-3 text-right tabular-nums">
                      <div className="flex items-center justify-end gap-2">
                        <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(100, d.stats.occupancyPct)}%` }}
                          />
                        </div>
                        {d.stats.occupancyPct}%
                        <span className="text-xs text-muted-foreground">
                          ({d.stats.roomsSold}/{d.stats.roomsAvailable})
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-3 text-right tabular-nums">
                      {formatMoney(d.stats.roomRevenueMinor, d.stats.currency)}
                    </TableCell>
                    <TableCell className="px-2 py-3 text-right tabular-nums">
                      {formatMoney(d.stats.adrMinor, d.stats.currency)}
                    </TableCell>
                    <TableCell className="px-2 py-3 text-right tabular-nums">
                      {formatMoney(d.stats.revparMinor, d.stats.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
