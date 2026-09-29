import * as React from 'react';

import { cn } from '../lib/utils.js';

const sizes = {
  /** Sidebar and sign-in screens. */
  md: 'size-9 rounded-xl shadow-md [&_svg]:size-5',
  /** The guest portal's centered screens. */
  lg: 'size-12 rounded-2xl shadow-lg [&_svg]:size-6',
};

/** The app's logo tile: an icon on the primary-to-info gradient. Decorative (aria-hidden). */
export function BrandMark({
  icon: Icon,
  size = 'md',
  className,
}: {
  /** An icon component, e.g. from lucide-react. */
  icon: React.ComponentType<{ className?: string }>;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-linear-to-br from-primary to-info text-primary-foreground shadow-primary/30',
        sizes[size],
        className,
      )}
    >
      <Icon />
    </span>
  );
}
