import { Skeleton, SkeletonCard } from '@hotel/ui';
import { t } from '@/lib/i18n';

/** Placeholder for a page's header and first cards, used while a route segment loads. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">{t('loading')}</span>
      <PagePlaceholder />
    </div>
  );
}

/** Mirrors the shell while the session loads, so the page does not jump when it arrives. */
export function ShellSkeleton() {
  return (
    <div className="min-h-dvh lg:pl-64" role="status" aria-busy="true">
      <span className="sr-only">{t('loading')}</span>
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-6 border-r bg-sidebar p-4 lg:flex">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-xl" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
          ))}
        </div>
      </aside>
      <header className="flex h-14 items-center justify-between border-b px-4 lg:hidden">
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="size-9 rounded-lg" />
      </header>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <PagePlaceholder />
      </div>
    </div>
  );
}

function PagePlaceholder() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </>
  );
}
