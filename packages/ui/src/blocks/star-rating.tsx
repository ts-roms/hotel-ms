'use client';

import { Star } from 'lucide-react';
import * as React from 'react';

import { Button } from '../components/button.js';
import { cn } from '../lib/utils.js';

/**
 * A one-to-five star picker: stars light up on hover/focus and a click submits the rating.
 * All text comes from the caller, so it can be translated.
 */
export function StarRating({
  prompt,
  label,
  starLabel,
  disabled,
  onRate,
}: {
  /** Shown before the stars, e.g. "How did we do?". */
  prompt: React.ReactNode;
  /** Accessible name of the star group. */
  label: string;
  /** Accessible name of the button for `count` stars. */
  starLabel: (count: number) => string;
  disabled: boolean;
  onRate: (n: number) => void;
}) {
  const [hover, setHover] = React.useState(0);
  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{prompt}</span>
      <div role="group" aria-label={label} className="flex" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={starLabel(n)}
            disabled={disabled}
            className="size-auto rounded p-1 duration-150 hover:scale-125 hover:bg-transparent active:scale-100 [&_svg]:size-5"
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => onRate(n)}
          >
            <Star
              className={cn(
                'size-5 transition-colors',
                n <= hover ? 'fill-warning text-warning' : 'text-muted-foreground/50',
              )}
            />
          </Button>
        ))}
      </div>
    </div>
  );
}
