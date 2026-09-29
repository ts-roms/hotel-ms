import { Card, LoadingRegion, Skeleton } from '@hotel/ui';
import { t } from '@/lib/i18n';

/** Placeholder cards while the queue loads. */
export function ServiceRequestsSkeleton() {
  return (
    <LoadingRegion label={t('loading')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <Card key={i} className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </Card>
      ))}
    </LoadingRegion>
  );
}
