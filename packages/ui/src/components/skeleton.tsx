import * as React from 'react';

import { cn } from '../lib/utils.js';

/** Placeholder block with a shimmer sweep. Size it with width/height utilities. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative isolate overflow-hidden rounded-md bg-muted',
        'before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-linear-to-r before:from-transparent before:via-foreground/6 before:to-transparent',
        className,
      )}
      {...props}
    />
  );
}
