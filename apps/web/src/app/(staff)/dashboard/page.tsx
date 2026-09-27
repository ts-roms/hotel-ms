'use client';

import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  LoadingRegion,
  PageHeader,
  Skeleton,
  SkeletonCard,
  StatCard,
} from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, CalendarDays, Clock, Coins, KeyRound } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { hasPermission, useSession } from '@/lib/session';

export default function DashboardPage() {
  const session = useSession();
  const properties = useQuery({
    queryKey: ['properties', session.data?.activeOrganizationId],
    queryFn: () => api.properties.list({ limit: 100 }),
    enabled: !!session.data?.activeOrganizationId,
  });

  const propertyNames = new Map(properties.data?.items.map((p) => [p.id, p.name]));
  const access = groupGrants(session.data?.grants ?? []);
  const permissionCount = new Set(session.data?.grants.map((g) => g.permission)).size;
  const firstName = session.data?.identity.displayName.split(' ')[0];
  // First property page this user can open; without one the cards are not links.
  const landing = LANDING_PAGES.find((l) => hasPermission(session.data, l.permission))?.href;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={
          <>
            {t('dashboard.welcome')}
            {firstName && <span className="text-primary">, {firstName}</span>}
          </>
        }
        description={t('dashboard.propertiesDescription')}
      />

      <div className="stagger grid gap-4 sm:grid-cols-2">
        <StatCard
          label={t('dashboard.propertyCount')}
          value={
            properties.data ? properties.data.items.length : <Skeleton className="mt-1 h-7 w-10" />
          }
          icon={<Building2 />}
        />
        <StatCard
          label={t('dashboard.permissionCount')}
          value={permissionCount}
          icon={<KeyRound />}
          tone="info"
        />
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">{t('dashboard.properties')}</h2>

        {properties.isError && <Alert>{t('error.generic')}</Alert>}
        {properties.isPending && (
          <LoadingRegion label={t('loading')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </LoadingRegion>
        )}
        {properties.data?.items.length === 0 && (
          <EmptyState icon={<Building2 />} title={t('dashboard.empty')} />
        )}

        <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.data?.items.map((p) => (
            <PropertyLink key={p.id} href={landing && `/p/${p.id}/${landing}`}>
              <Card className={cn('relative h-full overflow-hidden', landing && 'hover-lift')}>
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary to-info opacity-70 transition-opacity group-hover:opacity-100"
                />
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{p.name}</CardTitle>
                    <Badge variant="primary" className="font-mono">
                      {p.code}
                    </Badge>
                  </div>
                  <CardDescription>
                    {[p.city, p.countryCode].filter(Boolean).join(', ')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <dl className="grid gap-2 text-sm">
                    <Detail icon={<CalendarDays />} label={t('property.businessDate')}>
                      {formatDate(p.currentBusinessDate)}
                    </Detail>
                    <Detail icon={<Clock />} label={t('property.timezone')}>
                      {p.timezone}
                    </Detail>
                    <Detail icon={<Coins />} label={t('property.currency')}>
                      {p.currency}
                    </Detail>
                  </dl>
                  {landing && (
                    <span className="flex items-center gap-1 text-sm font-medium text-primary">
                      {t('dashboard.open')}
                      <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-1" />
                    </span>
                  )}
                </CardContent>
              </Card>
            </PropertyLink>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">{t('dashboard.access')}</h2>
        <Card>
          <CardContent className="stagger flex flex-col divide-y p-0">
            {access.map(([scope, permissions]) => (
              <div key={scope} className="flex flex-col gap-2 p-5 sm:flex-row sm:gap-6">
                <span className="w-44 shrink-0 text-sm font-medium">
                  {scope === 'ORGANIZATION'
                    ? t('scope.organization')
                    : (propertyNames.get(scope) ?? scope)}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {permissions.map((permission) => (
                    <Badge key={permission} className="font-mono">
                      {permission}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

const LANDING_PAGES = [
  { href: 'front-desk', permission: 'reservation.read' },
  { href: 'housekeeping', permission: 'housekeeping.read' },
  { href: 'rooms', permission: 'room.read' },
];

function PropertyLink({ href, children }: { href: string | undefined; children: ReactNode }) {
  if (!href) return <div className="group">{children}</div>;
  return (
    <Link href={href} className="group rounded-xl">
      {children}
    </Link>
  );
}

function Detail({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="flex items-center gap-2 text-muted-foreground [&_svg]:size-4">
        {icon}
        {label}
      </dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function groupGrants(
  grants: { permission: string; scopeType: string; propertyId: string | null }[],
) {
  const byScope = new Map<string, string[]>();
  for (const g of grants) {
    const key = g.scopeType === 'ORGANIZATION' ? 'ORGANIZATION' : g.propertyId!;
    byScope.set(key, [...(byScope.get(key) ?? []), g.permission]);
  }
  return [...byScope];
}
