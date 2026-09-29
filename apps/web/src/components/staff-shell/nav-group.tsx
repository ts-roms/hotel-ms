'use client';

import { cn } from '@hotel/ui';
import Link from 'next/link';
import { t } from '@/lib/i18n';
import type { NavItem } from '@/lib/nav';

/** A titled list of sidebar links; the link matching the current path is highlighted. */
export function NavGroup({
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
        // Exact match or a page below it: /me must not light up on /members.
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
