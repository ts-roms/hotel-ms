import * as React from 'react';

import { Card, CardDescription, CardHeader, CardTitle } from '../components/card.js';
import { cn } from '../lib/utils.js';
import { DocumentTitle } from './document-title.js';

/**
 * The frosted, centered card of a signed-out screen (staff sign-in steps, the guest portal's
 * welcome): a title, an optional description, then the content. Each app supplies its own
 * backdrop and brand around it. A plain-string `title` also becomes the browser tab title;
 * pass `documentTitle` when it is markup.
 */
export function ShellCard({
  title,
  documentTitle,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  documentTitle?: string;
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
      <DocumentTitle title={documentTitle ?? (typeof title === 'string' ? title : undefined)} />
      <CardHeader className="gap-2 pb-4 text-center">
        <CardTitle className="text-xl">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {children}
    </Card>
  );
}
