import { cn } from '@hotel/ui';
import { Hotel } from 'lucide-react';

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-primary to-info text-primary-foreground shadow-md shadow-primary/30',
        className,
      )}
    >
      <Hotel className="size-5" />
    </span>
  );
}
