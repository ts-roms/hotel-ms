'use client';

import { Button, cn } from '@hotel/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { type MessageKey, t } from '@/lib/i18n';
import { hasPermission, nextRoute, useLogout, useSession } from '@/lib/session';

const NAV: { href: string; label: MessageKey; permission?: string }[] = [
  { href: '/dashboard', label: 'nav.dashboard' },
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

  const info = session.data;
  useEffect(() => {
    if (info === null) router.replace('/login');
    else if (info && (info.mfaPending || !info.activeOrganizationId))
      router.replace(nextRoute(info));
  }, [info, router]);

  if (!info?.activeOrganizationId || info.mfaPending) {
    return <p className="p-6 text-muted-foreground">{t('loading')}</p>;
  }
  const org = info.memberships.find((m) => m.organizationId === info.activeOrganizationId);

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
          <div className="flex items-center gap-2">
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
          {NAV.filter((item) => !item.permission || hasPermission(info, item.permission)).map(
            (item) => (
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
            ),
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
