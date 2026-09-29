'use client';

import type { Property, SessionInfo } from '@hotel/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from '@/components/brand';
import { t } from '@/lib/i18n';
import { HOME_NAV, type NavItem, OPS_NAV, ORG_NAV, PROPERTY_NAV } from '@/lib/nav';
import { hasPermission } from '@/lib/session';
import { NavGroup } from './nav-group';
import { PropertySwitcher } from './property-switcher';
import { SidebarSearch } from './sidebar-search';
import { UserFooter } from './user-footer';

/** Sidebar content, shared by the desktop rail and the mobile drawer. */
export function Sidebar({
  info,
  organizationName,
  properties,
  propertyId,
  onSearch,
}: {
  info: SessionInfo;
  organizationName?: string;
  properties: Property[];
  /** The property in the URL, else the remembered or first one. */
  propertyId?: string;
  onSearch?: () => void;
}) {
  const pathname = usePathname();
  const allowed = (i: NavItem) => !i.permission || hasPermission(info, i.permission);

  const propertySections = propertyId
    ? PROPERTY_NAV.map((section) => ({
        title: section.title,
        items: section.items
          .filter(allowed)
          .map((i) => ({ ...i, href: `/p/${propertyId}/${i.href}` })),
      })).filter((section) => section.items.length > 0)
    : [];
  const orgNav = [...ORG_NAV.filter(allowed), ...(info.identity.platformOperator ? [OPS_NAV] : [])];

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <Link href="/dashboard" className="flex items-center gap-3 rounded-lg px-1 py-1">
        <BrandMark />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-xs text-muted-foreground">{t('app.name')}</span>
          <span className="truncate font-semibold">{organizationName}</span>
        </div>
      </Link>

      {propertyId && <PropertySwitcher properties={properties} propertyId={propertyId} />}

      <nav className="-mx-1 flex flex-1 flex-col gap-5 overflow-y-auto px-1">
        <NavGroup items={[HOME_NAV]} pathname={pathname} />
        <SidebarSearch onSearch={onSearch} />
        {propertySections.map((section) => (
          <NavGroup
            key={section.title}
            title={t(section.title)}
            items={section.items}
            pathname={pathname}
          />
        ))}
        {orgNav.length > 0 && (
          <NavGroup title={t('nav.sectionOrganization')} items={orgNav} pathname={pathname} />
        )}
      </nav>

      <UserFooter info={info} />
    </div>
  );
}
