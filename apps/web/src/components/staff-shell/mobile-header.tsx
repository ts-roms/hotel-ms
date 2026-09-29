'use client';

import { Button, Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@hotel/ui';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand';
import { NotificationBell } from '@/components/notification-bell';
import { t } from '@/lib/i18n';

/** Top bar below the `lg` breakpoint, with the sidebar in a drawer. Hidden when printing. */
export function MobileHeader({
  organizationName,
  menuOpen,
  onMenuOpenChange,
  children,
}: {
  organizationName?: string;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  /** The sidebar content shown in the drawer. */
  children: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background/80 px-4 backdrop-blur-lg lg:hidden print:hidden">
      <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
        <BrandMark className="size-8" />
        <span className="truncate font-semibold">{organizationName}</span>
      </Link>
      <span className="flex-1" />
      <NotificationBell placement="down" />
      <Sheet open={menuOpen} onOpenChange={onMenuOpenChange}>
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
          <SheetTitle className="sr-only">{organizationName ?? t('app.name')}</SheetTitle>
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
          {children}
        </SheetContent>
      </Sheet>
    </header>
  );
}
