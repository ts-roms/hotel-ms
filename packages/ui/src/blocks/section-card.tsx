import * as React from 'react';

import { Card, CardDescription, CardHeader, CardTitle } from '../components/card.js';

/**
 * A card with an icon and a title (and optionally a description and header actions). The body
 * is the children, usually a `CardContent`.
 */
export function SectionCard({
  icon: Icon,
  title,
  description,
  actions,
  headerClassName,
  children,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & {
  /** An icon component, e.g. from lucide-react; drawn small in the primary color. */
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Shown at the end of the title row. */
  actions?: React.ReactNode;
  headerClassName?: string;
}) {
  const heading = (
    <CardTitle className="flex items-center gap-2 text-base">
      {Icon && <Icon className="size-4 text-primary" />}
      {title}
    </CardTitle>
  );
  return (
    <Card {...props}>
      <CardHeader className={headerClassName}>
        {actions ? (
          <div className="flex items-center justify-between gap-2">
            {heading}
            {actions}
          </div>
        ) : (
          heading
        )}
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {children}
    </Card>
  );
}
