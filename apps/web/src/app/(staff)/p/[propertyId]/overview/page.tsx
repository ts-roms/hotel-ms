'use client';

import { formatDate, formatMoney } from '@hotel/format';
import { Alert, Card, CardContent, CardHeader, CardTitle, PageHeader, Skeleton } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, usePropertyId } from '@/lib/property';

function Stat({ label, value, href }: { label: string; value: ReactNode; href?: string }) {
  const body = (
    <div className="flex flex-col gap-0.5 rounded-lg border p-3 transition-colors hover:bg-accent/40">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {children}
      </CardContent>
    </Card>
  );
}

/** Today at the property (spec §66, ADR-0025): sections by the user's permissions. */
export default function OverviewPage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const dashboard = useQuery({
    queryKey: ['property-dashboard', propertyId],
    queryFn: pms.dashboard,
    refetchInterval: 60_000,
  });
  const d = dashboard.data;
  const link = (path: string) => `/p/${propertyId}/${path}`;
  if (dashboard.error) return <Alert>{errorMessage(dashboard.error)}</Alert>;
  if (!d) return <Skeleton className="h-64 w-full rounded-xl" />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={d.propertyName}
        description={`${t('mgmt.businessDate')} ${formatDate(d.businessDate)}`}
      />
      {d.rooms && (
        <Section title={t('mgmt.rooms')}>
          <Stat label={t('mgmt.occupancy')} value={`${d.rooms.occupancyPct}%`} />
          <Stat
            label={t('mgmt.inHouse')}
            value={`${d.rooms.occupied} / ${d.rooms.total - d.rooms.outOfOrder}`}
            href={link('front-desk')}
          />
          <Stat
            label={t('mgmt.arrivals')}
            value={`${d.rooms.arrivalsCheckedIn} / ${d.rooms.arrivalsExpected}`}
            href={link('front-desk')}
          />
          <Stat
            label={t('mgmt.departures')}
            value={`${d.rooms.departuresCheckedOut} / ${d.rooms.departuresExpected}`}
            href={link('front-desk')}
          />
          <Stat
            label={t('mgmt.newReservations')}
            value={d.rooms.reservationsMadeToday}
            href={link('reservations')}
          />
        </Section>
      )}
      {d.revenue && (
        <Section title={t('mgmt.revenue')}>
          <Stat
            label={t('mgmt.revenueToday')}
            value={formatMoney(d.revenue.todayMinor, d.currency)}
            href={link('reports')}
          />
          <Stat
            label={t('mgmt.revenueMtd')}
            value={formatMoney(d.revenue.monthToDateMinor, d.currency)}
            href={link('reports')}
          />
        </Section>
      )}
      {d.staff && (
        <Section title={t('mgmt.staff')}>
          <Stat label={t('mgmt.scheduled')} value={d.staff.scheduled} href={link('attendance')} />
          <Stat label={t('mgmt.present')} value={d.staff.present} href={link('attendance')} />
          <Stat label={t('mgmt.late')} value={d.staff.late} href={link('attendance')} />
          <Stat label={t('mgmt.absent')} value={d.staff.absent} href={link('attendance')} />
          <Stat label={t('mgmt.onLeave')} value={d.staff.onLeave} href={link('leave')} />
        </Section>
      )}
      {d.operations && (
        <Section title={t('mgmt.operations')}>
          <Stat
            label={t('mgmt.dirtyRooms')}
            value={d.operations.dirtyRooms}
            href={link('housekeeping')}
          />
          <Stat
            label={t('mgmt.openMaintenance')}
            value={
              d.operations.urgentMaintenance
                ? `${d.operations.openMaintenance} (${d.operations.urgentMaintenance}!)`
                : d.operations.openMaintenance
            }
            href={link('maintenance')}
          />
          <Stat
            label={t('mgmt.guestRequests')}
            value={d.operations.openGuestRequests}
            href={link('service-requests')}
          />
          <Stat
            label={t('mgmt.foodOrders')}
            value={d.operations.activeFoodOrders}
            href={link('orders')}
          />
        </Section>
      )}
      {d.hr && (
        <Section title={t('mgmt.hr')}>
          <Stat
            label={t('mgmt.pendingLeave')}
            value={d.hr.pendingLeaveRequests}
            href={link('leave')}
          />
          <Stat
            label={t('mgmt.birthdays')}
            value={d.hr.birthdaysToday.length ? d.hr.birthdaysToday.join(', ') : '—'}
          />
        </Section>
      )}
    </div>
  );
}
