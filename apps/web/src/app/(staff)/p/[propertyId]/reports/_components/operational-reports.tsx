'use client';

import { addDays, formatDate, formatMoney } from '@hotel/format';
import {
  Alert,
  buttonVariants,
  Button,
  Card,
  CardContent,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { duration, today } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { useCan, usePms } from '@/lib/property';
import { statusLabel } from '@/lib/status';

const TABS = [
  { key: 'occupancy', label: 'mgmt.tab.occupancy', permission: 'finance.report.read' },
  { key: 'fnb', label: 'mgmt.tab.fnb', permission: 'finance.report.read' },
  { key: 'guest-services', label: 'mgmt.tab.guestServices', permission: 'guest_service.read' },
  { key: 'hr', label: 'mgmt.tab.hr', permission: 'attendance.read' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-2 border-b py-1 last:border-0">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** Operational reports with CSV export (spec §41, ADR-0025). */
export function OperationalReports({ propertyId }: { propertyId: string }) {
  const pms = usePms(propertyId);
  const can = useCan();
  const tabs = TABS.filter((tab) => can(tab.permission));
  const [tab, setTab] = useState<Tab | null>(null);
  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(addDays(today(), -29));
  const active = tab ?? tabs[0]?.key ?? null;
  const valid = from <= to;
  const report = useQuery({
    queryKey: ['operational-report', propertyId, active, from, to],
    queryFn: (): Promise<unknown> => {
      switch (active) {
        case 'occupancy':
          return pms.occupancyReport(from, to);
        case 'fnb':
          return pms.fnbReport(from, to);
        case 'guest-services':
          return pms.guestServiceReport(from, to);
        default:
          return pms.hrReport(from, to);
      }
    },
    enabled: !!active && valid,
  });
  if (!active) return null;
  const data = report.data as Record<string, unknown> | undefined;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((x) => (
            <Button
              key={x.key}
              size="sm"
              variant={active === x.key ? 'default' : 'outline'}
              onClick={() => setTab(x.key)}
            >
              {t(x.label)}
            </Button>
          ))}
          <span className="flex-1" />
          <Input
            type="date"
            className="h-9 w-auto"
            aria-label={t('mgmt.from')}
            value={from}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
          <Input
            type="date"
            className="h-9 w-auto"
            aria-label={t('mgmt.to')}
            value={to}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
          <a
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
            href={pms.reportExportUrl(active, from, to)}
            download
          >
            CSV
          </a>
        </div>
        {report.error && <Alert>{errorMessage(report.error)}</Alert>}
        {data && active === 'occupancy' && <Occupancy data={data as never} />}
        {data && active === 'fnb' && <Fnb data={data as never} />}
        {data && active === 'guest-services' && <GuestServices data={data as never} />}
        {data && active === 'hr' && <Hr data={data as never} />}
      </CardContent>
    </Card>
  );
}

function Occupancy({
  data,
}: {
  data: Awaited<ReturnType<ReturnType<typeof usePms>['occupancyReport']>>;
}) {
  const m = (v: number) => formatMoney(v, data.currency);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-x-6 sm:grid-cols-2">
        <Row label={t('mgmt.occupancy')} value={`${data.totals.occupancyPct}%`} />
        <Row
          label={t('mgmt.roomsSold')}
          value={`${data.totals.roomsSold} / ${data.totals.roomsAvailable}`}
        />
        <Row label={t('mgmt.roomRevenue')} value={m(data.totals.roomRevenueMinor)} />
        <Row label="ADR" value={m(data.totals.adrMinor)} />
        <Row label="RevPAR" value={m(data.totals.revparMinor)} />
        <Row label={t('mgmt.newReservations')} value={data.totals.reservationsMade} />
        <Row label={t('mgmt.cancellations')} value={data.totals.cancellations} />
        <Row label={t('mgmt.closedDays')} value={data.closedDays} />
      </div>
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="h-8 px-2">{t('mgmt.date')}</TableHead>
            <TableHead className="h-8 px-2 text-right">{t('mgmt.occupancy')}</TableHead>
            <TableHead className="h-8 px-2 text-right">ADR</TableHead>
            <TableHead className="h-8 px-2 text-right">RevPAR</TableHead>
            <TableHead className="h-8 px-2 text-right">{t('mgmt.arrivals')}</TableHead>
            <TableHead className="h-8 px-2 text-right">{t('mgmt.departures')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.days.map((d) => (
            <TableRow key={d.date}>
              <TableCell className="px-2 py-1">{formatDate(d.date)}</TableCell>
              <TableCell className="px-2 py-1 text-right tabular-nums">{d.occupancyPct}%</TableCell>
              <TableCell className="px-2 py-1 text-right tabular-nums">{m(d.adrMinor)}</TableCell>
              <TableCell className="px-2 py-1 text-right tabular-nums">
                {m(d.revparMinor)}
              </TableCell>
              <TableCell className="px-2 py-1 text-right tabular-nums">{d.arrivals}</TableCell>
              <TableCell className="px-2 py-1 text-right tabular-nums">{d.departures}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Fnb({ data }: { data: Awaited<ReturnType<ReturnType<typeof usePms>['fnbReport']>> }) {
  const m = (v: number) => formatMoney(v, data.currency);
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <Row label={t('mgmt.orders')} value={data.orders} />
        <Row label={t('mgmt.sales')} value={m(data.salesMinor)} />
        <Row label={t('mgmt.roomServiceSales')} value={m(data.roomServiceSalesMinor)} />
        <Row label={t('mgmt.roomCharged')} value={m(data.roomChargedMinor)} />
        <Row label={t('mgmt.averageOrder')} value={m(data.averageOrderMinor)} />
        <Row label={t('mgmt.cancelled')} value={data.cancelled} />
      </div>
      <div>
        <strong>{t('mgmt.popularItems')}</strong>
        {data.topItems.map((i) => (
          <Row key={i.name} label={`${i.name} ×${i.quantity}`} value={m(i.salesMinor)} />
        ))}
      </div>
    </div>
  );
}

function GuestServices({
  data,
}: {
  data: Awaited<ReturnType<ReturnType<typeof usePms>['guestServiceReport']>>;
}) {
  const minutes = (v: number | null) => (v === null ? '—' : duration(v));
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <Row label={t('mgmt.requests')} value={data.requests} />
        <Row label={t('mgmt.open')} value={data.open} />
        <Row label={t('mgmt.completed')} value={data.completed} />
        <Row label={t('mgmt.avgCompletion')} value={minutes(data.averageCompletionMinutes)} />
        <Row
          label={t('mgmt.avgRating')}
          value={data.averageRating === null ? '—' : `${data.averageRating} (${data.ratings})`}
        />
      </div>
      <div>
        {data.byCategory.map((c) => (
          <Row
            key={c.category}
            label={`${statusLabel(c.category)} (${c.requests})`}
            value={minutes(c.averageCompletionMinutes)}
          />
        ))}
      </div>
    </div>
  );
}

function Hr({ data }: { data: Awaited<ReturnType<ReturnType<typeof usePms>['hrReport']>> }) {
  const a = data.attendance;
  return (
    <div className="grid gap-6 sm:grid-cols-3">
      <div>
        <Row label={t('mgmt.headcount')} value={data.headcount} />
        {data.byDepartment.map((d) => (
          <Row key={d.department} label={d.department} value={d.headcount} />
        ))}
      </div>
      <div>
        <Row label={t('mgmt.present')} value={a.present} />
        <Row label={t('mgmt.late')} value={`${a.late} (${duration(a.lateMinutes)})`} />
        <Row label={t('mgmt.absent')} value={a.absent} />
        <Row label={t('mgmt.worked')} value={duration(a.workedMinutes)} />
        <Row label={t('mgmt.overtime')} value={duration(a.overtimeMinutes)} />
        <Row label={t('mgmt.undertime')} value={duration(a.undertimeMinutes)} />
      </div>
      <div>
        {data.leave.length === 0 && (
          <span className="text-muted-foreground">{t('mgmt.noLeave')}</span>
        )}
        {data.leave.map((l) => (
          <Row key={l.leaveType} label={`${l.leaveType} (${l.requests})`} value={`${l.days} d`} />
        ))}
      </div>
    </div>
  );
}
