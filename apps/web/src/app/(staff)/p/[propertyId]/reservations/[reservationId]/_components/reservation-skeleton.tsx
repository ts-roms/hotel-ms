'use client';

import { Card, LoadingRegion, Skeleton, SkeletonCard, SkeletonText } from '@hotel/ui';
import { t } from '@/lib/i18n';

/** Placeholder shaped like a detail page: a header card and two section cards. */
export function DetailSkeleton() {
  return (
    <LoadingRegion label={t('loading')} className="flex max-w-3xl flex-col gap-4">
      <Skeleton className="h-4 w-16" />
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <SkeletonText lines={2} />
      </Card>
      <SkeletonCard lines={4} />
      <SkeletonCard lines={3} />
    </LoadingRegion>
  );
}
