import * as React from 'react';

import { Card } from '../components/card.js';
import { Skeleton } from '../components/skeleton.js';
import { cn } from '../lib/utils.js';

/** Screen-reader announcement for a region whose content is still loading. */
export function LoadingRegion({
  label,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className} {...props}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <Card className={cn('p-6', className)}>
      <div className="mb-5 flex items-center justify-between gap-4">
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <SkeletonText lines={lines} />
    </Card>
  );
}

/** A list row: avatar, two text lines and a trailing badge. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-4 rounded-xl border bg-card p-4', className)}>
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/5" />
      </div>
      <Skeleton className="hidden h-4 w-24 sm:block" />
      <Skeleton className="h-6 w-20 rounded-full" />
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex gap-4 border-b pb-3">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b py-3.5 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton
              key={c}
              className={cn('h-4 flex-1', c === 0 && 'max-w-24', (r + c) % 3 === 1 && 'w-2/3')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
