import * as React from 'react';

import { Card } from '../components/card.js';
import { cn } from '../lib/utils.js';

const tones = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
};

/**
 * Headline number tile for dashboards. `compact` draws a small bordered tile for grids of many
 * figures. With `href` the tile is a link; pass the app's router link (e.g. next/link) as
 * `linkComponent` for client-side navigation.
 */
export function StatCard({
  label,
  value,
  icon,
  tone = 'primary',
  compact,
  href,
  linkComponent: LinkComponent = 'a',
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: keyof typeof tones;
  compact?: boolean;
  href?: string;
  linkComponent?: React.ElementType;
  className?: string;
}) {
  const tile = compact ? (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border p-3 transition-colors',
        href && 'hover:bg-accent/40',
        className,
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  ) : (
    <Card
      className={cn(
        'flex items-center gap-4 p-4 sm:p-5',
        href && 'hover:border-ring/40',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'hidden size-11 shrink-0 items-center justify-center rounded-xl sm:flex [&_svg]:size-5',
            tones[tone],
          )}
        >
          {icon}
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <div className="truncate text-xs text-muted-foreground sm:text-sm">{label}</div>
        <div className="text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">{value}</div>
      </div>
    </Card>
  );
  return href ? <LinkComponent href={href}>{tile}</LinkComponent> : tile;
}
