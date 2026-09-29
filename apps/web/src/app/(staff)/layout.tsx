'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { MobileHeader } from '@/components/staff-shell/mobile-header';
import { ShellSkeleton } from '@/components/staff-shell/shell-skeleton';
import { Sidebar } from '@/components/staff-shell/sidebar';
import { lastProperty, useProperties, useRoutePropertyId } from '@/lib/property';
import { nextRoute, useSession } from '@/lib/session';

/**
 * Signed-in staff shell: sidebar, mobile drawer and the page area. This gate is for navigation
 * only; the API enforces every authentication and authorization rule on its own. Property
 * context (remembering the property, unknown properties) belongs to p/[propertyId]/layout.tsx.
 */
export default function StaffLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const properties = useProperties();
  const routePropertyId = useRoutePropertyId();
  const [menuOpen, setMenuOpen] = useState(false);

  const info = session.data;
  useEffect(() => {
    if (info === null) router.replace('/login');
    else if (info && (info.mfaPending || !info.activeOrganizationId))
      router.replace(nextRoute(info));
  }, [info, router]);

  // Close the mobile drawer after navigating.
  useEffect(() => setMenuOpen(false), [pathname]);

  if (!info?.activeOrganizationId || info.mfaPending) return <ShellSkeleton />;
  const organizationName = info.memberships.find(
    (m) => m.organizationId === info.activeOrganizationId,
  )?.organizationName;

  // Off property pages, the property nav points at the remembered (else the first) property.
  const propertyList = properties.data?.items ?? [];
  const remembered = typeof window === 'undefined' ? null : lastProperty();
  const propertyId =
    routePropertyId ?? propertyList.find((p) => p.id === remembered)?.id ?? propertyList[0]?.id;

  const sidebar = (
    <Sidebar
      info={info}
      organizationName={organizationName}
      properties={propertyList}
      propertyId={propertyId}
      onSearch={() => setMenuOpen(false)}
    />
  );

  return (
    <div className="min-h-dvh lg:pl-64 print:pl-0">
      {/* Desktop sidebar. The shell is hidden when printing (invoices, receipts). */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar lg:block print:hidden">
        {sidebar}
      </aside>

      <MobileHeader
        organizationName={organizationName}
        menuOpen={menuOpen}
        onMenuOpenChange={setMenuOpen}
      >
        {sidebar}
      </MobileHeader>

      {/* Re-keyed per path so every page gets the entrance animation. */}
      <main
        key={pathname}
        className="mx-auto max-w-6xl animate-slide-up p-4 sm:p-6 lg:p-8 print:max-w-none print:p-0"
      >
        {children}
      </main>
    </div>
  );
}
