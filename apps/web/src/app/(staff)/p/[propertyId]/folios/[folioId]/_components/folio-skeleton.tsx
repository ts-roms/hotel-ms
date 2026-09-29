import { Card, LoadingRegion, Skeleton, SkeletonTable } from '@hotel/ui';
import { t } from '@/lib/i18n';

/** Placeholder for the folio page while it loads. */
export function FolioSkeleton() {
  return (
    <LoadingRegion label={t('loading')} className="flex max-w-3xl flex-col gap-4">
      <Card className="p-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
        <SkeletonTable rows={5} columns={4} />
      </Card>
      <Card className="flex gap-2 p-6">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-28 rounded-lg" />
      </Card>
    </LoadingRegion>
  );
}
