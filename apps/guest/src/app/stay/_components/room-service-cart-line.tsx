'use client';

import type { MenuItem } from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import { Button, Checkbox, cn, Label, RadioGroup, RadioGroupItem } from '@hotel/ui';
import { Minus, Plus } from 'lucide-react';
import { t } from '@/lib/i18n';

export interface Line {
  item: MenuItem;
  quantity: number;
  modifierIds: string[];
}

export const unitPrice = (l: Line) =>
  l.item.priceMinor +
  l.item.modifierGroups
    .flatMap((g) => g.modifiers)
    .filter((m) => l.modifierIds.includes(m.id))
    .reduce((s, m) => s + m.priceMinor, 0);

/** One dish in the room-service cart: its quantity and modifier choices. */
export function CartLine({
  line: l,
  currency,
  onUpdate,
  onRemove,
}: {
  line: Line;
  currency: string;
  onUpdate: (change: Partial<Line>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{l.item.name}</span>
        <span className="flex items-center gap-1 rounded-full border p-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-7 rounded-full"
            aria-label={t('roomService.less')}
            onClick={() => (l.quantity > 1 ? onUpdate({ quantity: l.quantity - 1 }) : onRemove())}
          >
            <Minus />
          </Button>
          <span className="w-5 text-center font-medium tabular-nums">{l.quantity}</span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 rounded-full"
            aria-label={t('roomService.more')}
            onClick={() => onUpdate({ quantity: Math.min(50, l.quantity + 1) })}
          >
            <Plus />
          </Button>
        </span>
      </div>
      {l.item.modifierGroups.map((g) => {
        const ids = new Set(g.modifiers.map((x) => x.id));
        const others = l.modifierIds.filter((id) => !ids.has(id));
        const inGroup = l.modifierIds.filter((id) => ids.has(id));
        const single = g.maxSelect === 1;
        const toggle = (id: string) => {
          const next = single
            ? [id]
            : inGroup.includes(id)
              ? inGroup.filter((x) => x !== id)
              : [...inGroup, id].slice(-g.maxSelect);
          onUpdate({ modifierIds: [...others, ...next] });
        };
        const chips = g.modifiers.map((m) => {
          const on = inGroup.includes(m.id);
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
                  onCheckedChange={() => toggle(m.id)}
                />
              )}
              {m.name}
              {m.priceMinor > 0 && ` +${formatMoney(m.priceMinor, currency)}`}
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
                value={inGroup[0] ?? ''}
                onValueChange={toggle}
              >
                {chips}
              </RadioGroup>
            ) : (
              chips
            )}
          </div>
        );
      })}
    </div>
  );
}
