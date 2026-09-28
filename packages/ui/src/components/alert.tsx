import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils.js';

export const alertVariants = cva('animate-fade-in rounded-lg border px-4 py-3 text-sm', {
  variants: {
    variant: {
      destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
      info: 'border-info/25 bg-info/10 text-foreground',
      success: 'border-success/25 bg-success/10 text-foreground',
      warning: 'border-warning/30 bg-warning/10 text-foreground',
    },
  },
  defaultVariants: { variant: 'destructive' },
});

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

/** Inline message. Errors (the default) announce assertively, other variants politely. */
export function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      role={variant && variant !== 'destructive' ? 'status' : 'alert'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn('mb-1 font-medium leading-none', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-sm opacity-90', className)} {...props} />;
}

/** Informational Alert. */
export function Notice(props: Omit<AlertProps, 'variant'>) {
  return <Alert variant="info" {...props} />;
}
