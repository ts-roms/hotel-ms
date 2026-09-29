'use client';

import {
  type CartLine,
  cartCount,
  cartTotal,
  linePrice,
  type OrderItemInput,
  type Room,
  type StaffOrderRequest,
  toggleModifier,
} from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  CardContent,
  Input,
  ModifierPicker,
  NativeSelect,
  SectionCard,
} from '@hotel/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, X } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, usePropertyId } from '@/lib/property';

/** The order being built: cart lines, charge method, room, notes and the place button. */
export function OrderCart({
  outlet,
  currency,
  rooms,
  cart,
  onCartChange,
}: {
  outlet: string;
  currency: string;
  rooms: Room[] | undefined;
  cart: CartLine[];
  onCartChange: (cart: CartLine[]) => void;
}) {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const [chargeMethod, setChargeMethod] =
    useState<StaffOrderRequest['chargeMethod']>('ROOM_CHARGE');
  const [roomId, setRoomId] = useState('');
  const [notes, setNotes] = useState('');
  // One key per attempt: a retry after a network error reuses it, a new order gets a new one.
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());

  const place = useMutation({
    mutationFn: () =>
      pms.placeOrder(
        {
          outletId: outlet,
          chargeMethod,
          roomId: roomId || null,
          notes,
          items: cart.map<OrderItemInput>((l) => ({
            menuItemId: l.item.id,
            quantity: l.quantity,
            modifierIds: l.modifierIds,
            notes: '',
          })),
        },
        attemptKey,
      ),
    onSuccess: () => {
      onCartChange([]);
      setNotes('');
      setAttemptKey(crypto.randomUUID());
      return queryClient.invalidateQueries({ queryKey: ['orders', propertyId] });
    },
  });

  const total = cartTotal(cart);
  const update = (index: number, change: Partial<CartLine>) =>
    onCartChange(cart.map((l, i) => (i === index ? { ...l, ...change } : l)));

  return (
    <SectionCard
      className="animate-fade-in lg:sticky lg:top-6 lg:self-start"
      headerClassName="pb-4"
      icon={ShoppingBag}
      title={
        <>
          {t('fnb.newOrder')}
          {cart.length > 0 && (
            <Badge variant="primary" className="tabular-nums">
              {cartCount(cart)}
            </Badge>
          )}
        </>
      }
    >
      <CardContent className="flex flex-col gap-3 text-sm">
        {cart.length === 0 && (
          <p className="rounded-lg border border-dashed py-8 text-center text-muted-foreground">
            {t('fnb.emptyCart')}
          </p>
        )}
        {cart.map((l, index) => (
          <div key={index} className="flex animate-scale-in flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{l.item.name}</span>
              <span className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  className="h-8 w-16"
                  aria-label={t('fnb.quantity')}
                  value={l.quantity}
                  onChange={(e) =>
                    update(index, { quantity: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
                <span className="w-24 text-right font-medium tabular-nums">
                  {formatMoney(linePrice(l), currency)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 hover:text-destructive"
                  aria-label={t('fnb.remove')}
                  onClick={() => onCartChange(cart.filter((_, i) => i !== index))}
                >
                  <X />
                </Button>
              </span>
            </div>
            <ModifierPicker
              groups={l.item.modifierGroups}
              selected={l.modifierIds}
              onToggle={(group, id) =>
                update(index, { modifierIds: toggleModifier(l.modifierIds, group, id) })
              }
              formatPrice={(minor) => formatMoney(minor, currency)}
            />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <NativeSelect
            className="w-auto"
            aria-label={t('fnb.chargeMethod')}
            value={chargeMethod}
            onChange={(e) => setChargeMethod(e.target.value as typeof chargeMethod)}
          >
            <option value="ROOM_CHARGE">{t('fnb.roomCharge')}</option>
            <option value="PAY_ON_DELIVERY">{t('fnb.payOnDelivery')}</option>
            <option value="PAY_AT_OUTLET">{t('fnb.payAtOutlet')}</option>
          </NativeSelect>
          <NativeSelect
            className="w-auto"
            aria-label={t('fnb.room')}
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          >
            <option value="">{t('fnb.noRoom')}</option>
            {rooms
              ?.filter((r) => !r.archived)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number}
                </option>
              ))}
          </NativeSelect>
          <Input
            className="min-w-40 flex-1"
            placeholder={t('fnb.notes')}
            aria-label={t('fnb.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {place.error && <Alert>{errorMessage(place.error)}</Alert>}
        <Button
          size="lg"
          loading={place.isPending}
          disabled={cart.length === 0}
          onClick={() => place.mutate()}
        >
          {t('fnb.placeOrder')} ·{' '}
          <span className="tabular-nums">{formatMoney(total, currency)}</span>
        </Button>
      </CardContent>
    </SectionCard>
  );
}
