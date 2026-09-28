import * as React from 'react';

import { cn } from '../lib/utils.js';

/** Round initials badge for people. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
  // Stable hue per name so the same guest always gets the same color.
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
        className,
      )}
      style={{
        backgroundColor: `light-dark(oklch(0.93 0.05 ${hue}), oklch(0.33 0.07 ${hue}))`,
        color: `light-dark(oklch(0.42 0.13 ${hue}), oklch(0.88 0.08 ${hue}))`,
      }}
    >
      {initials || '?'}
    </span>
  );
}
