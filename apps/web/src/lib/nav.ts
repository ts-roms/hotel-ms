import {
  Activity,
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
  FileClock,
  FileUp,
  Gauge,
  IdCard,
  KeyRound,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  MoonStar,
  PackageSearch,
  Plane,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tablet,
  Timer,
  Users,
  UserX,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { SessionInfo } from '@hotel/contracts';
import type { MessageKey } from './i18n';
import { hasPermission, hasPropertyPermission } from './permissions';

/** Staff navigation catalog. The shell filters it by permission; the API enforces access. */
export interface NavItem {
  href: string;
  label: MessageKey;
  icon: LucideIcon;
  permission?: string;
}

export interface NavSection {
  title: MessageKey;
  items: NavItem[];
}

export const HOME_NAV: NavItem = {
  href: '/dashboard',
  label: 'nav.dashboard',
  icon: LayoutDashboard,
};

/**
 * Pages that work on one property live under /p/[propertyId]/<href>. Grouped by department so
 * the sidebar stays scannable; the order within a group is the order in the sidebar.
 */
export const PROPERTY_NAV: NavSection[] = [
  {
    title: 'nav.group.frontOffice',
    items: [
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
        href: 'service-requests',
        label: 'nav.serviceRequests',
        icon: BellRing,
        permission: 'guest_service.read',
      },
      {
        href: 'id-review',
        label: 'nav.idReview',
        icon: IdCard,
        permission: 'guest.identity.review',
      },
    ],
  },
  {
    title: 'nav.group.operations',
    items: [
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
      {
        href: 'lost-found',
        label: 'nav.lostFound',
        icon: PackageSearch,
        permission: 'lost_found.log',
      },
    ],
  },
  {
    title: 'nav.group.fnb',
    items: [
      { href: 'kitchen', label: 'nav.kitchen', icon: ChefHat, permission: 'fnb.order.read' },
      { href: 'orders', label: 'nav.orders', icon: ReceiptText, permission: 'fnb.order.read' },
      { href: 'menus', label: 'nav.menus', icon: BookOpen, permission: 'fnb.menu.manage' },
    ],
  },
  {
    title: 'nav.group.people',
    items: [
      { href: 'schedule', label: 'nav.schedule', icon: CalendarClock, permission: 'schedule.read' },
      { href: 'attendance', label: 'nav.attendance', icon: Clock, permission: 'attendance.read' },
      { href: 'leave', label: 'nav.leave', icon: Plane, permission: 'leave.read' },
    ],
  },
  {
    title: 'nav.group.finance',
    items: [
      { href: 'cashier', label: 'nav.cashier', icon: Wallet, permission: 'cashier.shift' },
      { href: 'accounts', label: 'nav.accounts', icon: Building2, permission: 'folio.transfer' },
      {
        href: 'night-audit',
        label: 'nav.nightAudit',
        icon: MoonStar,
        permission: 'night_audit.run',
      },
      {
        href: 'reports',
        label: 'nav.reports',
        icon: ChartColumn,
        permission: 'finance.report.read',
      },
      {
        href: 'finance-settings',
        label: 'nav.financeSettings',
        icon: Landmark,
        permission: 'exchange_rate.manage',
      },
    ],
  },
  {
    title: 'nav.group.admin',
    items: [
      { href: 'rooms', label: 'nav.rooms', icon: BedDouble, permission: 'room.read' },
      { href: 'devices', label: 'nav.devices', icon: Tablet, permission: 'device.manage' },
      {
        href: 'guest-portal',
        label: 'nav.guestPortal',
        icon: Smartphone,
        permission: 'property.settings.manage',
      },
      { href: 'import', label: 'nav.import', icon: FileUp, permission: 'guest.update' },
    ],
  },
];

/** The signed-in member's own pages (absolute paths), whatever their role. */
export const ME_NAV: NavItem[] = [
  { href: '/me', label: 'nav.myTime', icon: Timer, permission: 'attendance.punch.own' },
  { href: '/settings/security', label: 'nav.security', icon: KeyRound },
];

/** Organization-wide pages (absolute paths). */
export const ORG_NAV: NavItem[] = [
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
  { href: '/privacy', label: 'nav.privacy', icon: UserX, permission: 'privacy.manage' },
];

/** Platform operators (ADR-0029): the ops dashboard, outside any organization. */
export const OPS_NAV: NavItem = { href: '/ops', label: 'nav.ops', icon: Activity };

type Session = SessionInfo | null | undefined;

/** An organization-level nav item the member may open (held at any scope). */
export function canOpen(info: Session, item: NavItem): boolean {
  return !item.permission || hasPermission(info, item.permission);
}

/** A property nav item the member may open at this property. */
export function canOpenAt(info: Session, item: NavItem, propertyId: string): boolean {
  return !item.permission || hasPropertyPermission(info, item.permission, propertyId);
}

const PROPERTY_ITEMS = PROPERTY_NAV.flatMap((s) => s.items);

/** The first property page (in sidebar order) the member may open at a property, if any. */
export function firstPropertyPage(info: Session, propertyId: string): string | undefined {
  return PROPERTY_ITEMS.find((i) => canOpenAt(info, i, propertyId))?.href;
}

/** The first organization page (under `prefix`, in sidebar order) the member may open, if any. */
export function firstOrgPage(info: Session, prefix: string): string | undefined {
  return ORG_NAV.find((i) => i.href.startsWith(prefix) && canOpen(info, i))?.href;
}

/**
 * Where to go when switching to another property. Keeps the same section when it is a nav page
 * the member may open there (/p/A/rooms → /p/B/rooms); record pages with no list of their own
 * (/p/A/folios/X, /p/A/documents/Y), non-property pages and sections not permitted at the
 * target fall back to the first page the member may open there (else the dashboard).
 */
export function propertySwitchTarget(pathname: string, propertyId: string, info: Session): string {
  const [, root, , section] = pathname.split('/');
  const current = root === 'p' ? PROPERTY_ITEMS.find((i) => i.href === section) : undefined;
  const target =
    current && canOpenAt(info, current, propertyId)
      ? current.href
      : firstPropertyPage(info, propertyId);
  return target ? `/p/${propertyId}/${target}` : '/dashboard';
}
