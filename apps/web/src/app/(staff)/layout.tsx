'use client';

import {
  Avatar,
  Button,
  cn,
  Input,
  NativeSelect,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  SkeletonCard,
} from '@hotel/ui';
import {
  ArrowLeftRight,
  BedDouble,
  BellRing,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  ChefHat,
  Clock,
  ConciergeBell,
  IdCard,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  LogOut,
  Menu,
  MoonStar,
  Plane,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Timer,
  Users,
  FileClock,
  Gauge,
  Search,
  Landmark,
  PackageSearch,
  Wrench,
  Smartphone,
  Tablet,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { BrandMark } from '@/components/brand';
import { NotificationBell } from '@/components/notification-bell';
import { ThemeToggle } from '@/components/theme';
import { type MessageKey, t } from '@/lib/i18n';
import { lastProperty, rememberProperty, useProperties, useRoutePropertyId } from '@/lib/property';
import { hasPermission, nextRoute, useLogout, useSession } from '@/lib/session';

interface NavItem {
  href: string;
  label: MessageKey;
  icon: LucideIcon;
  permission?: string;
}

/** Pages that work on one property live under /p/[propertyId]. */
const PROPERTY_NAV: NavItem[] = [
  { href: 'overview', label: 'nav.overview', icon: Gauge, permission: 'property.read' },
  {
    href: 'front-desk',
    label: 'nav.frontDesk',
    icon: ConciergeBell,
    permission: 'reservation.read',
  },
  {
    href: 'reservations',
    label: 'nav.reservations',
    icon: CalendarDays,
    permission: 'reservation.read',
  },
  {
    href: 'availability',
    label: 'nav.availability',
    icon: CalendarRange,
    permission: 'reservation.read',
  },
  { href: 'calendar', label: 'nav.calendar', icon: CalendarCheck, permission: 'property.read' },
  {
    href: 'housekeeping',
    label: 'nav.housekeeping',
    icon: Sparkles,
    permission: 'housekeeping.read',
  },
  {
    href: 'maintenance',
    label: 'nav.maintenance',
    icon: Wrench,
    permission: 'maintenance.read',
  },
  { href: 'lost-found', label: 'nav.lostFound', icon: PackageSearch, permission: 'lost_found.log' },
  {
    href: 'id-review',
    label: 'nav.idReview',
    icon: IdCard,
    permission: 'guest.identity.review',
  },
  {
    href: 'service-requests',
    label: 'nav.serviceRequests',
    icon: BellRing,
    permission: 'guest_service.read',
  },
  { href: 'kitchen', label: 'nav.kitchen', icon: ChefHat, permission: 'fnb.order.read' },
  { href: 'orders', label: 'nav.orders', icon: ReceiptText, permission: 'fnb.order.read' },
  { href: 'menus', label: 'nav.menus', icon: BookOpen, permission: 'fnb.menu.manage' },
  { href: 'devices', label: 'nav.devices', icon: Tablet, permission: 'device.manage' },
  { href: 'rooms', label: 'nav.rooms', icon: BedDouble, permission: 'room.read' },
  { href: 'schedule', label: 'nav.schedule', icon: CalendarClock, permission: 'schedule.read' },
  { href: 'attendance', label: 'nav.attendance', icon: Clock, permission: 'attendance.read' },
  { href: 'leave', label: 'nav.leave', icon: Plane, permission: 'leave.read' },
  { href: 'cashier', label: 'nav.cashier', icon: Wallet, permission: 'cashier.shift' },
  { href: 'accounts', label: 'nav.accounts', icon: Building2, permission: 'folio.transfer' },
  { href: 'reports', label: 'nav.reports', icon: ChartColumn, permission: 'finance.report.read' },
  {
    href: 'finance-settings',
    label: 'nav.financeSettings',
    icon: Landmark,
    permission: 'exchange_rate.manage',
  },
  {
    href: 'guest-portal',
    label: 'nav.guestPortal',
    icon: Smartphone,
    permission: 'property.settings.manage',
  },
  { href: 'night-audit', label: 'nav.nightAudit', icon: MoonStar, permission: 'night_audit.run' },
];

const ORG_NAV: NavItem[] = [
  { href: '/me', label: 'nav.myTime', icon: Timer, permission: 'attendance.punch.own' },
  { href: '/hr/leave-types', label: 'nav.leaveTypes', icon: Plane, permission: 'leave.configure' },
  { href: '/hr/employees', label: 'nav.employees', icon: IdCard, permission: 'employee.read' },
  {
    href: '/hr/document-retention',
    label: 'nav.documentRetention',
    icon: FileClock,
    permission: 'employee.documents',
  },
  { href: '/members', label: 'nav.members', icon: Users, permission: 'member.read' },
  { href: '/roles', label: 'nav.roles', icon: ShieldCheck, permission: 'role.read' },
  { href: '/settings/security', label: 'nav.security', icon: KeyRound },
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
  const [menuOpen, setMenuOpen] = useState(false);

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

  // Close the mobile drawer after navigating.
  useEffect(() => setMenuOpen(false), [pathname]);

  if (!info?.activeOrganizationId || info.mfaPending) return <ShellSkeleton />;
  const org = info.memberships.find((m) => m.organizationId === info.activeOrganizationId);

  // Keep the same section when switching property (/p/A/rooms → /p/B/rooms). Record pages
  // with no list of their own (/p/A/folios/X, /p/A/documents/Y) fall back to reservations.
  const switchProperty = (id: string) => {
    rememberProperty(id);
    const current = routePropertyId ? pathname.split('/')[3] : undefined;
    const section = PROPERTY_NAV.some((i) => i.href === current) ? current : 'reservations';
    router.push(`/p/${id}/${section}`);
  };

  const allowed = (i: NavItem) => !i.permission || hasPermission(info, i.permission);
  const propertyNav = propertyId
    ? PROPERTY_NAV.filter(allowed).map((i) => ({ ...i, href: `/p/${propertyId}/${i.href}` }))
    : [];
  const orgNav = ORG_NAV.filter(allowed);

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-4">
      <Link href="/dashboard" className="flex items-center gap-3 rounded-lg px-1 py-1">
        <BrandMark />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-xs text-muted-foreground">{t('app.name')}</span>
          <span className="truncate font-semibold">{org?.organizationName}</span>
        </div>
      </Link>

      {propertyList.length > 1 && propertyId && (
        <NativeSelect
          aria-label={t('nav.property')}
          className="h-9"
          value={propertyId}
          onChange={(e) => switchProperty(e.target.value)}
        >
          {propertyList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      )}

      <nav className="-mx-1 flex flex-1 flex-col gap-5 overflow-y-auto px-1">
        <NavGroup
          items={[{ href: '/dashboard', label: 'nav.dashboard', icon: LayoutDashboard }]}
          pathname={pathname}
        />
        <form
          role="search"
          className="relative mb-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get('q')?.toString().trim() ?? '';
            if (q.length >= 2) {
              setMenuOpen(false);
              router.push(`/search?q=${encodeURIComponent(q)}`);
            }
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            name="q"
            aria-label={t('search.title')}
            placeholder={t('search.placeholder')}
            className="h-9 bg-background pl-8 pr-2"
          />
        </form>
        {propertyNav.length > 0 && (
          <NavGroup title={t('nav.sectionProperty')} items={propertyNav} pathname={pathname} />
        )}
        {orgNav.length > 0 && (
          <NavGroup title={t('nav.sectionOrganization')} items={orgNav} pathname={pathname} />
        )}
      </nav>

      <div className="flex flex-col gap-2 border-t pt-4">
        <div className="flex items-center gap-3">
          <Avatar name={info.identity.displayName} className="size-9 text-xs" />
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm font-medium">{info.identity.displayName}</span>
            <span className="truncate text-xs text-muted-foreground">{info.identity.email}</span>
          </div>
          <NotificationBell placement="up" />
          <ThemeToggle />
        </div>
        <div className="flex gap-2">
          {info.memberships.length > 1 && (
            <Button variant="ghost" size="sm" className="flex-1" asChild>
              <Link href="/select-organization">
                <ArrowLeftRight />
                {t('nav.switchOrganization')}
              </Link>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 hover:text-destructive"
            loading={logout.isPending}
            onClick={async () => {
              await logout.mutateAsync().catch(() => undefined);
              router.replace('/login');
            }}
          >
            {!logout.isPending && <LogOut />}
            {t('nav.signOut')}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar lg:block">
        {sidebar}
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background/80 px-4 backdrop-blur-lg lg:hidden">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
          <BrandMark className="size-8" />
          <span className="truncate font-semibold">{org?.organizationName}</span>
        </Link>
        <span className="flex-1" />
        <NotificationBell placement="down" />
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('nav.openMenu')}>
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            hideClose
            aria-describedby={undefined}
            className="w-72 max-w-[85vw] gap-0 bg-sidebar shadow-2xl lg:hidden"
          >
            <SheetTitle className="sr-only">{org?.organizationName ?? t('app.name')}</SheetTitle>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-3 top-3"
                aria-label={t('nav.closeMenu')}
              >
                <X />
              </Button>
            </SheetClose>
            {sidebar}
          </SheetContent>
        </Sheet>
      </header>

      {/* Re-keyed per path so every page gets the entrance animation. */}
      <main key={pathname} className="mx-auto max-w-6xl animate-slide-up p-4 sm:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}

function NavGroup({
  title,
  items,
  pathname,
}: {
  title?: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {title && (
        <span className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {title}
        </span>
      )}
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200',
              active
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-all duration-300',
                active ? 'opacity-100' : 'scale-y-0 opacity-0',
              )}
            />
            <Icon className="size-4 shrink-0 transition-transform duration-200 group-hover:scale-110" />
            {t(item.label)}
          </Link>
        );
      })}
    </div>
  );
}

/** Mirrors the shell while the session loads, so the page does not jump when it arrives. */
function ShellSkeleton() {
  return (
    <div className="min-h-dvh lg:pl-64" role="status" aria-busy="true">
      <span className="sr-only">{t('loading')}</span>
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-6 border-r bg-sidebar p-4 lg:flex">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-xl" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
          ))}
        </div>
      </aside>
      <header className="flex h-14 items-center justify-between border-b px-4 lg:hidden">
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="size-9 rounded-lg" />
      </header>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
