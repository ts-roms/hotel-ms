'use client';

import { type CartLine as Line, toggleModifier } from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import { Button, ModifierPicker } from '@hotel/ui';
import { Minus, Plus } from 'lucide-react';
import { t } from '@/lib/i18n';

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
      <ModifierPicker
        groups={l.item.modifierGroups}
        selected={l.modifierIds}
        onToggle={(group, id) =>
          onUpdate({ modifierIds: toggleModifier(l.modifierIds, group, id) })
        }
        formatPrice={(minor) => formatMoney(minor, currency)}
      />
    </div>
  );
}
