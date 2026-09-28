'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
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
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">{t('mgmt.property')}</th>
              <th className="px-3 text-right">{t('mgmt.occupancy')}</th>
              <th className="px-3 text-right">{t('mgmt.inHouse')}</th>
              <th className="px-3 text-right">{t('mgmt.revenueToday')}</th>
              <th className="px-3 text-right">{t('mgmt.revenueMtd')}</th>
              <th className="pl-3 text-right">{t('mgmt.headcount')}</th>
            </tr>
          </thead>
          <tbody>
            {d.properties.map((p) => (
              <tr key={p.propertyId} className="border-t">
                <td className="py-2 pr-3">
                  <Link
                    className="font-medium hover:underline"
                    href={`/p/${p.propertyId}/overview`}
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="px-3 text-right tabular-nums">{occupancy(p.occupancyPct)}</td>
                <td className="px-3 text-right tabular-nums">
                  {p.occupiedRooms === null ? '—' : `${p.occupiedRooms} / ${p.totalRooms}`}
                </td>
                <td className="px-3 text-right tabular-nums">
                  {money(p.revenueTodayMinor, p.currency)}
                </td>
                <td className="px-3 text-right tabular-nums">
                  {money(p.revenueMonthToDateMinor, p.currency)}
                </td>
                <td className="pl-3 text-right tabular-nums">{p.headcount ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          {d.properties.length > 1 && (
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="py-2 pr-3">{t('mgmt.groupTotal')}</td>
                <td className="px-3 text-right tabular-nums">{occupancy(d.totals.occupancyPct)}</td>
                <td className="px-3 text-right tabular-nums">
                  {d.totals.occupiedRooms} / {d.totals.totalRooms}
                </td>
                <td className="px-3 text-right tabular-nums">
                  {money(d.totals.revenueTodayMinor, d.totals.currency)}
                </td>
                <td className="px-3 text-right tabular-nums">
                  {money(d.totals.revenueMonthToDateMinor, d.totals.currency)}
                </td>
                <td className="pl-3 text-right tabular-nums">{d.totals.headcount}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </CardContent>
    </Card>
  );
}
