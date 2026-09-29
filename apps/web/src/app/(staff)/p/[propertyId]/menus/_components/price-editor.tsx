'use client';

import { formatMoney, minorToInput, parseMoney } from '@hotel/format';
import { Button, Input } from '@hotel/ui';
import { Check, Pencil } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/lib/i18n';

export function PriceEditor({
  value,
  currency,
  saving,
  onSave,
}: {
  value: number;
  currency: string;
  saving: boolean;
  onSave: (minor: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  if (text === null) {
    return (
      <Button
        type="button"
        variant="ghost"
        disabled={saving}
        className="group h-auto gap-1 rounded-md px-2 py-1 text-foreground tabular-nums disabled:opacity-60 [&_svg]:size-3"
        onClick={() => setText(minorToInput(value, currency))}
      >
        {formatMoney(value, currency)}
        <Pencil className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </Button>
    );
  }
  const parsed = parseMoney(text, currency);
  return (
    <form
      className="flex animate-fade-in items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed !== null) onSave(parsed);
        setText(null);
      }}
    >
      <Input
        className="h-8 w-24"
        autoFocus
        aria-label={t('fnb.price')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        size="icon"
        className="size-8"
        type="submit"
        aria-label={t('fnb.savePrice')}
        disabled={parsed === null}
      >
        <Check />
      </Button>
    </form>
  );
}
