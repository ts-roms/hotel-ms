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
import type { MessageKey } from './i18n';

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

/** Organization-wide pages (absolute paths). */
export const ORG_NAV: NavItem[] = [
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
  { href: '/privacy', label: 'nav.privacy', icon: UserX, permission: 'privacy.manage' },
  { href: '/settings/security', label: 'nav.security', icon: KeyRound },
];

/** Platform operators (ADR-0029): the ops dashboard, outside any organization. */
export const OPS_NAV: NavItem = { href: '/ops', label: 'nav.ops', icon: Activity };

const PROPERTY_SECTIONS = new Set(PROPERTY_NAV.flatMap((s) => s.items.map((i) => i.href)));

/**
 * Where to go when switching to another property. Keeps the same section when it is a nav page
 * (/p/A/rooms → /p/B/rooms); record pages with no list of their own (/p/A/folios/X,
 * /p/A/documents/Y) and non-property pages fall back to reservations.
 */
export function propertySwitchTarget(pathname: string, propertyId: string): string {
  const [, root, , section] = pathname.split('/');
  const keep = root === 'p' && section !== undefined && PROPERTY_SECTIONS.has(section);
  return `/p/${propertyId}/${keep ? section : 'reservations'}`;
}
