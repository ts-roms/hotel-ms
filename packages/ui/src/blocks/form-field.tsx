import * as React from 'react';

import { Label } from '../components/label.js';
import { Skeleton } from '../components/skeleton.js';
import { cn } from '../lib/utils.js';

/** A labelled form control, with an optional hint and error below it. */
export function FormField({
  label,
  htmlFor,
  loading,
  description,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  /** The id of the control, so the label focuses it. */
  htmlFor: string;
  /** The control's options are still loading: show a placeholder in its place. */
  loading?: boolean;
  description?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {loading ? <Skeleton className="h-10 w-full rounded-lg" /> : children}
      {description && !error && <p className="text-xs text-muted-foreground">{description}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
