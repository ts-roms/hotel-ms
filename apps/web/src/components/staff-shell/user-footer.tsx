'use client';

import type { SessionInfo } from '@hotel/contracts';
import { Avatar, Button } from '@hotel/ui';
import { ArrowLeftRight, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NotificationBell } from './notification-bell';
import { ThemeToggle } from './theme';
import { t } from '@/lib/i18n';
import { useLogout } from '@/lib/session';

/** Signed-in identity, notifications, theme, organization switch and sign-out. */
export function UserFooter({ info }: { info: SessionInfo }) {
  const router = useRouter();
  const logout = useLogout();
  return (
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
  );
}
