import * as React from 'react';

import { cn } from '../lib/utils.js';
import { DocumentTitle } from './document-title.js';

/**
 * A page's heading row. A plain-string `title` also becomes the browser tab title (see
 * `DocumentTitleProvider`); pass `documentTitle` when the heading is markup.
 */
export function PageHeader({
  title,
  documentTitle,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  documentTitle?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <DocumentTitle title={documentTitle ?? (typeof title === 'string' ? title : undefined)} />
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
