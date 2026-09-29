import * as React from 'react';

import { Card, CardDescription, CardHeader, CardTitle } from '../components/card.js';
import { cn } from '../lib/utils.js';

/**
 * The frosted, centered card of a signed-out screen (staff sign-in steps, the guest portal's
 * welcome): a title, an optional description, then the content. Each app supplies its own
 * backdrop and brand around it.
 */
export function ShellCard({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        'w-full animate-scale-in border-border/70 bg-card/90 shadow-xl shadow-black/5 backdrop-blur-xl',
        className,
      )}
    >
      <CardHeader className="gap-2 pb-4 text-center">
        <CardTitle className="text-xl">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {children}
    </Card>
  );
}
