'use client';

import { formatDate, formatMoney } from '@hotel/format';
import { Alert, CardContent, PageHeader, SectionCard, Skeleton, StatCard } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, usePropertyId } from '@/lib/property';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SectionCard title={title}>
      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {children}
      </CardContent>
    </SectionCard>
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
  // Tiles link to the page behind the figure, with client-side navigation.
  const link = (path: string) => ({ href: `/p/${propertyId}/${path}`, linkComponent: Link });
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
          <StatCard compact label={t('mgmt.occupancy')} value={`${d.rooms.occupancyPct}%`} />
          <StatCard
            compact
            label={t('mgmt.inHouse')}
            value={`${d.rooms.occupied} / ${d.rooms.total - d.rooms.outOfOrder}`}
            {...link('front-desk')}
          />
          <StatCard
            compact
            label={t('mgmt.arrivals')}
            value={`${d.rooms.arrivalsCheckedIn} / ${d.rooms.arrivalsExpected}`}
            {...link('front-desk')}
          />
          <StatCard
            compact
            label={t('mgmt.departures')}
            value={`${d.rooms.departuresCheckedOut} / ${d.rooms.departuresExpected}`}
            {...link('front-desk')}
          />
          <StatCard
            compact
            label={t('mgmt.newReservations')}
            value={d.rooms.reservationsMadeToday}
            {...link('reservations')}
          />
        </Section>
      )}
      {d.revenue && (
        <Section title={t('mgmt.revenue')}>
          <StatCard
            compact
            label={t('mgmt.revenueToday')}
            value={formatMoney(d.revenue.todayMinor, d.currency)}
            {...link('reports')}
          />
          <StatCard
            compact
            label={t('mgmt.revenueMtd')}
            value={formatMoney(d.revenue.monthToDateMinor, d.currency)}
            {...link('reports')}
          />
        </Section>
      )}
      {d.staff && (
        <Section title={t('mgmt.staff')}>
          <StatCard
            compact
            label={t('mgmt.scheduled')}
            value={d.staff.scheduled}
            {...link('attendance')}
          />
          <StatCard
            compact
            label={t('mgmt.present')}
            value={d.staff.present}
            {...link('attendance')}
          />
          <StatCard compact label={t('mgmt.late')} value={d.staff.late} {...link('attendance')} />
          <StatCard
            compact
            label={t('mgmt.absent')}
            value={d.staff.absent}
            {...link('attendance')}
          />
          <StatCard compact label={t('mgmt.onLeave')} value={d.staff.onLeave} {...link('leave')} />
        </Section>
      )}
      {d.operations && (
        <Section title={t('mgmt.operations')}>
          <StatCard
            compact
            label={t('mgmt.dirtyRooms')}
            value={d.operations.dirtyRooms}
            {...link('housekeeping')}
          />
          <StatCard
            compact
            label={t('mgmt.openMaintenance')}
            value={
              d.operations.urgentMaintenance
                ? `${d.operations.openMaintenance} (${d.operations.urgentMaintenance}!)`
                : d.operations.openMaintenance
            }
            {...link('maintenance')}
          />
          <StatCard
            compact
            label={t('mgmt.guestRequests')}
            value={d.operations.openGuestRequests}
            {...link('service-requests')}
          />
          <StatCard
            compact
            label={t('mgmt.foodOrders')}
            value={d.operations.activeFoodOrders}
            {...link('orders')}
          />
        </Section>
      )}
      {d.hr && (
        <Section title={t('mgmt.hr')}>
          <StatCard
            compact
            label={t('mgmt.pendingLeave')}
            value={d.hr.pendingLeaveRequests}
            {...link('leave')}
          />
          <StatCard
            compact
            label={t('mgmt.birthdays')}
            value={d.hr.birthdaysToday.length ? d.hr.birthdaysToday.join(', ') : '—'}
          />
        </Section>
      )}
    </div>
  );
}
