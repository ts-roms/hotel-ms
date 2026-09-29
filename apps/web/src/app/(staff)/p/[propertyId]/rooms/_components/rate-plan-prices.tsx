'use client';

import type { RatePlan, RoomType } from '@hotel/contracts';
import { formatMoney, minorToInput, parseMoney } from '@hotel/format';
import { Alert, Button, Input } from '@hotel/ui';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { useAction } from '@/lib/use-action';

export function RatePlanPrices({
  propertyId,
  plan,
  roomTypes,
  currency,
  editable,
  onDone,
}: {
  propertyId: string;
  plan: RatePlan;
  roomTypes: RoomType[];
  currency: string;
  editable: boolean;
  onDone: () => unknown;
}) {
  const pms = usePms(propertyId);
  const action = useAction({ onSuccess: () => onDone() });
  const initial = Object.fromEntries(
    roomTypes.map((rt) => {
      const price = plan.prices.find((p) => p.roomTypeId === rt.id);
      return [rt.id, price ? minorToInput(price.baseAmountMinor, currency) : ''];
    }),
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [invalid, setInvalid] = useState(false);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const prices: { roomTypeId: string; baseAmountMinor: number }[] = [];
    for (const [roomTypeId, text] of Object.entries(values)) {
      if (!text.trim()) continue;
      const amount = parseMoney(text, currency);
      if (amount === null) return setInvalid(true);
      prices.push({ roomTypeId, baseAmountMinor: amount });
    }
    setInvalid(false);
    action.mutate(() => pms.updateRatePlan(plan.id, plan.version, { prices }));
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <div className="font-medium">
        {plan.name} <span className="font-mono text-xs text-muted-foreground">{plan.code}</span>
      </div>
      {(invalid || action.error) && (
        <Alert>{invalid ? t('error.generic') : errorMessage(action.error)}</Alert>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {roomTypes.map((rt) => (
          <label key={rt.id} className="flex flex-col gap-1 text-sm">
            <span>
              {rt.code} · {t('rooms.basePrice')}
            </span>
            {editable ? (
              <Input
                inputMode="decimal"
                value={values[rt.id] ?? ''}
                onChange={(e) => setValues({ ...values, [rt.id]: e.target.value })}
              />
            ) : (
              <span>
                {plan.prices.find((p) => p.roomTypeId === rt.id)
                  ? formatMoney(
                      plan.prices.find((p) => p.roomTypeId === rt.id)!.baseAmountMinor,
                      currency,
                    )
                  : '—'}
              </span>
            )}
          </label>
        ))}
      </div>
      {editable && (
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="self-start"
          loading={action.isPending}
        >
          {t('rooms.savePrices')}
        </Button>
      )}
    </form>
  );
}
