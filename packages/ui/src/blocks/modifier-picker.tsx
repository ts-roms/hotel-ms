'use client';

import * as React from 'react';

import { Checkbox } from '../components/checkbox.js';
import { Label } from '../components/label.js';
import { RadioGroup, RadioGroupItem } from '../components/radio-group.js';
import { cn } from '../lib/utils.js';

export interface ModifierPickerGroup {
  id: string;
  name: string;
  /** 1 = pick exactly one (radio chips); more = checkbox chips. */
  maxSelect: number;
  modifiers: { id: string; name: string; priceMinor: number }[];
}

/**
 * Modifier choices of one dish (size, extras, ...) as chips: radio chips for single-choice
 * groups, checkbox chips otherwise. The caller owns the selection and the toggle rule.
 */
export function ModifierPicker<G extends ModifierPickerGroup>({
  groups,
  selected,
  onToggle,
  formatPrice,
  className,
}: {
  groups: G[];
  /** Chosen modifier ids, across all groups. */
  selected: readonly string[];
  onToggle: (group: G, modifierId: string) => void;
  /** Shown as "+price" after a modifier that costs extra. */
  formatPrice: (minor: number) => string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {groups.map((g) => {
        const single = g.maxSelect === 1;
        const chips = g.modifiers.map((m) => {
          const on = selected.includes(m.id);
          return (
            <Label
              key={m.id}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-normal leading-normal transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/40',
                on
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'bg-card text-foreground hover:border-ring/40',
              )}
            >
              {single ? (
                <RadioGroupItem
                  value={m.id}
                  className="size-3.5 focus-visible:ring-0 [&_span]:size-1.5"
                />
              ) : (
                <Checkbox
                  className="size-3.5 rounded-[3px] focus-visible:ring-0 [&_svg]:size-3"
                  checked={on}
                  onCheckedChange={() => onToggle(g, m.id)}
                />
              )}
              {m.name}
              {m.priceMinor > 0 && ` +${formatPrice(m.priceMinor)}`}
            </Label>
          );
        });
        return (
          <div key={g.id} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{g.name}</span>
            {single ? (
              <RadioGroup
                aria-label={g.name}
                className="flex flex-wrap gap-1.5"
                value={g.modifiers.find((m) => selected.includes(m.id))?.id ?? ''}
                onValueChange={(id) => onToggle(g, id)}
              >
                {chips}
              </RadioGroup>
            ) : (
              <div role="group" aria-label={g.name} className="flex flex-wrap gap-1.5">
                {chips}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
