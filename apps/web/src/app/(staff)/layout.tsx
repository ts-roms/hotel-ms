'use client';

import { Button } from '@hotel/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { t } from '@/lib/i18n';
import { useLogout, useSession } from '@/lib/session';

/**
 * Signed-in staff shell. This gate is for navigation only; the API enforces every
 * authentication and authorization rule on its own.
 */
export default function StaffLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const logout = useLogout();

  const info = session.data;
  useEffect(() => {
    if (info === null) router.replace('/login');
    else if (info && !info.activeOrganizationId) router.replace('/select-organization');
  }, [info, router]);

  if (!info?.activeOrganizationId) {
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
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
