'use client';

import { ApiError } from '@hotel/api-client';
import type { MenuItem, Order } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Notice,
  Select,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorMessage, formatMoney } from '@/lib/api';

const STATUS: Record<Order['status'], string> = {
  PENDING: 'Sent to the kitchen',
  CONFIRMED: 'Accepted',
  PREPARING: 'Being prepared',
  READY: 'Ready',
  OUT_FOR_DELIVERY: 'On its way',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

interface Line {
  item: MenuItem;
  quantity: number;
  modifierIds: string[];
}

const unitPrice = (l: Line) =>
  l.item.priceMinor +
  l.item.modifierGroups
    .flatMap((g) => g.modifiers)
    .filter((m) => l.modifierIds.includes(m.id))
    .reduce((s, m) => s + m.priceMinor, 0);

/** In-room dining for checked-in guests (blueprint §14). Hidden when the hotel has it off. */
export function RoomService() {
  const queryClient = useQueryClient();
  const menus = useQuery({ queryKey: ['menus'], queryFn: api.menus, retry: false });
  const orders = useQuery({ queryKey: ['orders'], queryFn: api.orders, refetchInterval: 20_000 });
  const [cart, setCart] = useState<Line[]>([]);
  const [chargeMethod, setChargeMethod] = useState<'ROOM_CHARGE' | 'PAY_ON_DELIVERY'>(
    'ROOM_CHARGE',
  );
  // Reused if the same order is retried after a network error; renewed after success.
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());

  // A delivered room-charge order is now on the folio: refresh the bill.
  const delivered = orders.data?.filter((o) => o.status === 'DELIVERED').length ?? 0;
  useEffect(() => {
    if (delivered > 0) void queryClient.invalidateQueries({ queryKey: ['bill'] });
  }, [delivered, queryClient]);

  const menu = menus.data?.[0];
  const place = useMutation({
    mutationFn: () =>
      api.placeOrder(
        {
          outletId: menu!.outlet.id,
          chargeMethod,
          notes: '',
          items: cart.map((l) => ({
            menuItemId: l.item.id,
            quantity: l.quantity,
            modifierIds: l.modifierIds,
            notes: '',
          })),
        },
        attemptKey,
      ),
    onSuccess: () => {
      setCart([]);
      setAttemptKey(crypto.randomUUID());
      return queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
  const cancel = useMutation({
    mutationFn: api.cancelOrder,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  });

  if (menus.error instanceof ApiError && menus.error.code === 'FEATURE_DISABLED') return null;
  if (!menu) return null;
  const total = cart.reduce((s, l) => s + unitPrice(l) * l.quantity, 0);
  const add = (item: MenuItem) => {
    const modifierIds = item.modifierGroups
      .filter((g) => g.minSelect > 0)
      .flatMap((g) => g.modifiers.slice(0, g.minSelect).map((m) => m.id));
    setCart([...cart, { item, quantity: 1, modifierIds }]);
  };
  const update = (index: number, change: Partial<Line>) =>
    setCart(cart.map((l, i) => (i === index ? { ...l, ...change } : l)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{menu.outlet.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {!menu.open && <Notice>Room service is closed right now.</Notice>}
        {menu.categories.map((c) => (
          <div key={c.id} className="flex flex-col gap-1">
            <div className="font-medium">{c.name}</div>
            {c.items.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-2">
                <span>
                  {i.name}
                  {i.description && (
                    <span className="block text-xs text-muted-foreground">{i.description}</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatMoney(i.priceMinor, menu.currency)}</span>
                  <Button size="sm" variant="outline" disabled={!menu.open} onClick={() => add(i)}>
                    Add
                  </Button>
                </span>
              </div>
            ))}
          </div>
        ))}

        {cart.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-3">
            {cart.map((l, index) => (
              <div key={index} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span>{l.item.name}</span>
                  <span className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="One less"
                      onClick={() =>
                        l.quantity > 1
                          ? update(index, { quantity: l.quantity - 1 })
                          : setCart(cart.filter((_, i) => i !== index))
                      }
                    >
                      −
                    </Button>
                    <span className="tabular-nums">{l.quantity}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="One more"
                      onClick={() => update(index, { quantity: Math.min(50, l.quantity + 1) })}
                    >
                      +
                    </Button>
                  </span>
                </div>
                {l.item.modifierGroups.map((g) => (
                  <div key={g.id} className="flex flex-wrap gap-2 text-xs">
                    <span className="text-muted-foreground">{g.name}:</span>
                    {g.modifiers.map((m) => {
                      const on = l.modifierIds.includes(m.id);
                      return (
                        <label key={m.id} className="flex items-center gap-1">
                          <input
                            type={g.maxSelect === 1 ? 'radio' : 'checkbox'}
                            name={`${index}-${g.id}`}
                            checked={on}
                            onChange={() => {
                              const ids = new Set(g.modifiers.map((x) => x.id));
                              const others = l.modifierIds.filter((id) => !ids.has(id));
                              const inGroup = l.modifierIds.filter((id) => ids.has(id));
                              const next =
                                g.maxSelect === 1
                                  ? [m.id]
                                  : on
                                    ? inGroup.filter((id) => id !== m.id)
                                    : [...inGroup, m.id].slice(-g.maxSelect);
                              update(index, { modifierIds: [...others, ...next] });
                            }}
                          />
                          {m.name}
                          {m.priceMinor > 0 && ` +${formatMoney(m.priceMinor, menu.currency)}`}
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
            <Select
              aria-label="Payment"
              value={chargeMethod}
              onChange={(e) => setChargeMethod(e.target.value as typeof chargeMethod)}
            >
              {menu.outlet.allowRoomCharge && (
                <option value="ROOM_CHARGE">Charge to my room</option>
              )}
              <option value="PAY_ON_DELIVERY">Pay on delivery</option>
            </Select>
            {place.error && <Alert>{errorMessage(place.error)}</Alert>}
            <Button disabled={place.isPending} onClick={() => place.mutate()}>
              Order · {formatMoney(total, menu.currency)}
            </Button>
          </div>
        )}

        {cancel.error && <Alert>{errorMessage(cancel.error)}</Alert>}
        {orders.data?.map((o) => (
          <div
            key={o.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
          >
            <span>
              {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
              <span className="block text-xs text-muted-foreground">
                {formatMoney(o.totalMinor, o.currency)}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <Badge>{STATUS[o.status]}</Badge>
              {o.status === 'PENDING' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(o.id)}
                >
                  Cancel
                </Button>
              )}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
