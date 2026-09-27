'use client';

import { Button, cn, Select } from '@hotel/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { type MessageKey, t } from '@/lib/i18n';
import { lastProperty, rememberProperty, useProperties, useRoutePropertyId } from '@/lib/property';
import { hasPermission, nextRoute, useLogout, useSession } from '@/lib/session';

interface NavItem {
  href: string;
  label: MessageKey;
  permission?: string;
}

/** Pages that work on one property live under /p/[propertyId]. */
const PROPERTY_NAV: NavItem[] = [
  { href: 'front-desk', label: 'nav.frontDesk', permission: 'reservation.read' },
  { href: 'reservations', label: 'nav.reservations', permission: 'reservation.read' },
  { href: 'availability', label: 'nav.availability', permission: 'reservation.read' },
  { href: 'housekeeping', label: 'nav.housekeeping', permission: 'housekeeping.read' },
  { href: 'service-requests', label: 'nav.serviceRequests', permission: 'guest_service.read' },
  { href: 'rooms', label: 'nav.rooms', permission: 'room.read' },
  { href: 'schedule', label: 'nav.schedule', permission: 'schedule.read' },
  { href: 'attendance', label: 'nav.attendance', permission: 'attendance.read' },
  { href: 'leave', label: 'nav.leave', permission: 'leave.read' },
  { href: 'night-audit', label: 'nav.nightAudit', permission: 'night_audit.run' },
];

const ORG_NAV: NavItem[] = [
  { href: '/me', label: 'nav.myTime', permission: 'attendance.punch.own' },
  { href: '/hr/employees', label: 'nav.employees', permission: 'employee.read' },
  { href: '/members', label: 'nav.members', permission: 'member.read' },
  { href: '/roles', label: 'nav.roles', permission: 'role.read' },
  { href: '/settings/security', label: 'nav.security' },
];

/**
 * Signed-in staff shell. This gate is for navigation only; the API enforces every
 * authentication and authorization rule on its own.
 */
export default function StaffLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const logout = useLogout();
  const properties = useProperties();
  const routePropertyId = useRoutePropertyId();

  const info = session.data;
  useEffect(() => {
    if (info === null) router.replace('/login');
    else if (info && (info.mfaPending || !info.activeOrganizationId))
      router.replace(nextRoute(info));
  }, [info, router]);

  const propertyList = properties.data?.items ?? [];
  const remembered = typeof window === 'undefined' ? null : lastProperty();
  const propertyId =
    routePropertyId ?? propertyList.find((p) => p.id === remembered)?.id ?? propertyList[0]?.id;

  useEffect(() => {
    if (routePropertyId) rememberProperty(routePropertyId);
  }, [routePropertyId]);

  if (!info?.activeOrganizationId || info.mfaPending) {
    return <p className="p-6 text-muted-foreground">{t('loading')}</p>;
  }
  const org = info.memberships.find((m) => m.organizationId === info.activeOrganizationId);

  // Keep the same page when switching property (/p/A/rooms → /p/B/rooms).
  const switchProperty = (id: string) => {
    rememberProperty(id);
    const section = routePropertyId ? pathname.split('/')[3] : 'reservations';
    router.push(`/p/${id}/${section ?? 'reservations'}`);
  };

  const navItems = [
    { href: '/dashboard', label: 'nav.dashboard' as MessageKey },
    ...(propertyId
      ? PROPERTY_NAV.filter((i) => !i.permission || hasPermission(info, i.permission)).map((i) => ({
          ...i,
          href: `/p/${propertyId}/${i.href}`,
        }))
      : []),
    ...ORG_NAV.filter((i) => !i.permission || hasPermission(info, i.permission)),
  ];

  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <Link href="/dashboard" className="text-sm text-muted-foreground">
              {t('app.name')}
            </Link>
            <span className="truncate font-semibold">{org?.organizationName}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {propertyList.length > 1 && propertyId && (
              <Select
                aria-label={t('nav.property')}
                className="h-9 w-auto"
                value={propertyId}
                onChange={(e) => switchProperty(e.target.value)}
              >
                {propertyList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {info.identity.displayName}
            </span>
            {info.memberships.length > 1 && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/select-organization">{t('nav.switchOrganization')}</Link>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={logout.isPending}
              onClick={async () => {
                await logout.mutateAsync().catch(() => undefined);
                router.replace('/login');
              }}
            >
              {t('nav.signOut')}
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-1.5 text-sm',
                pathname.startsWith(item.href)
                  ? 'bg-accent font-medium'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {t(item.label)}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
