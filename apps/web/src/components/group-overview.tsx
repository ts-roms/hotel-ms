'use client';

import { formatMoney } from '@hotel/format';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

/**
 * Group overview (spec §42, §67; ADR-0025): today's figures per property the user may see,
 * and group totals. Columns the user may not see stay blank.
 */
export function GroupOverview() {
  const dashboard = useQuery({
    queryKey: ['group-dashboard'],
    queryFn: api.dashboard,
    retry: false,
  });
  const d = dashboard.data;
  if (!d || d.properties.length === 0) return null;
  const money = (v: number | null, currency: string | null) =>
    v === null || currency === null ? '—' : formatMoney(v, currency);
  const occupancy = (v: number | null) => (v === null ? '—' : `${v}%`);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('mgmt.groupToday')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-0">{t('mgmt.property')}</TableHead>
              <TableHead className="text-right">{t('mgmt.occupancy')}</TableHead>
              <TableHead className="text-right">{t('mgmt.inHouse')}</TableHead>
              <TableHead className="text-right">{t('mgmt.revenueToday')}</TableHead>
              <TableHead className="text-right">{t('mgmt.revenueMtd')}</TableHead>
              <TableHead className="pr-0 text-right">{t('mgmt.headcount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.properties.map((p) => (
              <TableRow key={p.propertyId}>
                <TableCell className="pl-0">
                  <Link
                    className="font-medium hover:underline"
                    href={`/p/${p.propertyId}/overview`}
                  >
                    {p.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {occupancy(p.occupancyPct)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.occupiedRooms === null ? '—' : `${p.occupiedRooms} / ${p.totalRooms}`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(p.revenueTodayMinor, p.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(p.revenueMonthToDateMinor, p.currency)}
                </TableCell>
                <TableCell className="pr-0 text-right tabular-nums">{p.headcount ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {d.properties.length > 1 && (
            <TableFooter>
              <TableRow className="font-semibold">
                <TableCell className="pl-0">{t('mgmt.groupTotal')}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {occupancy(d.totals.occupancyPct)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {d.totals.occupiedRooms} / {d.totals.totalRooms}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(d.totals.revenueTodayMinor, d.totals.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(d.totals.revenueMonthToDateMinor, d.totals.currency)}
                </TableCell>
                <TableCell className="pr-0 text-right tabular-nums">{d.totals.headcount}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </CardContent>
    </Card>
  );
}
