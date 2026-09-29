import * as React from 'react';

import { Card, CardDescription, CardHeader, CardTitle } from '../components/card.js';
import { cn } from '../lib/utils.js';

/**
 * A card with an icon and a title (and optionally a description and header actions). The body
 * is the children, usually a `CardContent`.
 *
 * `variant="badge"` draws the icon in a tinted rounded badge with the description indented
 * under the title (the guest portal's section style); the default draws it small and inline.
 */
export function SectionCard({
  icon: Icon,
  title,
  description,
  actions,
  variant = 'inline',
  headerClassName,
  children,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & {
  /** An icon component, e.g. from lucide-react; drawn in the primary color. */
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Shown at the end of the title row. */
  actions?: React.ReactNode;
  variant?: 'inline' | 'badge';
  headerClassName?: string;
}) {
  const badge = variant === 'badge';
  const heading = (
    <CardTitle className={cn('flex items-center text-base', badge ? 'gap-3' : 'gap-2')}>
      {Icon &&
        (badge ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
        ) : (
          <Icon className="size-4 text-primary" />
        ))}
      {title}
    </CardTitle>
  );
  return (
    <Card {...props}>
      <CardHeader className={cn(badge && children && 'pb-4', headerClassName)}>
        {actions ? (
          <div className="flex items-center justify-between gap-2">
            {heading}
            {actions}
          </div>
        ) : (
          heading
        )}
        {description && (
          <CardDescription className={cn(badge && Icon && 'pl-12')}>{description}</CardDescription>
        )}
      </CardHeader>
      {children}
    </Card>
  );
}
