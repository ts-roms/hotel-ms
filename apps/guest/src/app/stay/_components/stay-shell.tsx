'use client';

import { LoadingRegion, Skeleton, SkeletonCard } from '@hotel/ui';
import { type ReactNode } from 'react';
import { t } from '@/lib/i18n';

export function StayShell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex max-w-lg flex-col gap-4 p-4 pb-12">{children}</main>;
}

export function StaySkeleton() {
  return (
    <LoadingRegion label={t('stay.loading')} className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-2xl bg-muted p-6">
        <Skeleton className="h-3 w-32 bg-foreground/10" />
        <Skeleton className="h-7 w-48 bg-foreground/10" />
        <div className="grid grid-cols-2 gap-3 pt-2">
          <Skeleton className="h-14 rounded-xl bg-foreground/10" />
          <Skeleton className="h-14 rounded-xl bg-foreground/10" />
        </div>
      </div>
      <SkeletonCard lines={2} />
      <SkeletonCard lines={3} />
    </LoadingRegion>
  );
}
