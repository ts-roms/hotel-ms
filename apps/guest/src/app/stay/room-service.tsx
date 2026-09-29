'use client';

import { ApiError } from '@hotel/api-client';
import type { MenuItem, Order } from '@hotel/contracts';
import {
  Alert,
  Badge,
  type BadgeVariant,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  Label,
  Notice,
  NativeSelect,
  RadioGroup,
  RadioGroupItem,
  SkeletonCard,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, errorMessage, formatMoney } from '@/lib/api';

const STATUS: Record<Order['status'], [string, BadgeVariant]> = {
  PENDING: ['Sent to the kitchen', 'info'],
  CONFIRMED: ['Accepted', 'primary'],
  PREPARING: ['Being prepared', 'warning'],
  READY: ['Ready', 'success'],
  OUT_FOR_DELIVERY: ['On its way', 'info'],
  DELIVERED: ['Delivered', 'neutral'],
  CANCELLED: ['Cancelled', 'danger'],
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
  // Outlets that do not allow room charges only offer pay on delivery: show and send that,
  // not the (hidden) room-charge default.
  const payment = menu && !menu.outlet.allowRoomCharge ? 'PAY_ON_DELIVERY' : chargeMethod;
  const place = useMutation({
    mutationFn: () =>
      api.placeOrder(
        {
          outletId: menu!.outlet.id,
          chargeMethod: payment,
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

  if (menus.isPending) return <SkeletonCard lines={4} />;
  if (menus.error instanceof ApiError && menus.error.code === 'FEATURE_DISABLED') return null;
  if (!menu) return null;
  const total = cart.reduce((s, l) => s + unitPrice(l) * l.quantity, 0);
  const count = cart.reduce((n, l) => n + l.quantity, 0);
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
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UtensilsCrossed className="size-4" />
          </span>
          {menu.outlet.name}
          <Badge variant={menu.open ? 'success' : 'neutral'} dot className="ml-auto">
            {menu.open ? 'Open' : 'Closed'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        {!menu.open && <Notice>Room service is closed right now.</Notice>}
        {menu.categories.map((c) => (
          <div key={c.id} className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {c.name}
            </div>
            {c.items.map((i) => (
              <div
                key={i.id}
                className="flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors hover:border-primary/30"
              >
                {i.imageVersion && (
                  <img
                    src={api.menuItemImageUrl(i.id, i.imageVersion)}
                    alt=""
                    loading="lazy"
                    className="size-16 shrink-0 rounded-lg bg-muted object-cover"
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{i.name}</span>
                  {i.description && (
                    <span className="text-xs text-muted-foreground">{i.description}</span>
                  )}
                  <span className="mt-0.5 tabular-nums text-muted-foreground">
                    {formatMoney(i.priceMinor, menu.currency)}
                  </span>
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  className="shrink-0 rounded-full"
                  aria-label={`Add ${i.name}`}
                  disabled={!menu.open}
                  onClick={() => add(i)}
                >
                  <Plus />
                </Button>
              </div>
            ))}
          </div>
        ))}

        {cart.length > 0 && (
          <div className="flex animate-scale-in flex-col gap-3 rounded-2xl bg-muted/50 p-3">
            <div className="flex items-center gap-2 px-1 font-medium">
              <ShoppingBag className="size-4 text-primary" />
              Your order
              <Badge variant="primary" className="tabular-nums">
                {count}
              </Badge>
            </div>
            {cart.map((l, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{l.item.name}</span>
                  <span className="flex items-center gap-1 rounded-full border p-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 rounded-full"
                      aria-label="One less"
                      onClick={() =>
                        l.quantity > 1
                          ? update(index, { quantity: l.quantity - 1 })
                          : setCart(cart.filter((_, i) => i !== index))
                      }
                    >
                      <Minus />
                    </Button>
                    <span className="w-5 text-center font-medium tabular-nums">{l.quantity}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 rounded-full"
                      aria-label="One more"
                      onClick={() => update(index, { quantity: Math.min(50, l.quantity + 1) })}
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
                    update(index, { modifierIds: [...others, ...next] });
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
                        {m.priceMinor > 0 && ` +${formatMoney(m.priceMinor, menu.currency)}`}
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
            ))}
            <NativeSelect
              aria-label="Payment"
              value={payment}
              onChange={(e) => setChargeMethod(e.target.value as typeof chargeMethod)}
            >
              {menu.outlet.allowRoomCharge && (
                <option value="ROOM_CHARGE">Charge to my room</option>
              )}
              <option value="PAY_ON_DELIVERY">Pay on delivery</option>
            </NativeSelect>
            {place.error && <Alert>{errorMessage(place.error)}</Alert>}
            <Button size="lg" loading={place.isPending} onClick={() => place.mutate()}>
              Order · <span className="tabular-nums">{formatMoney(total, menu.currency)}</span>
            </Button>
          </div>
        )}

        {cancel.error && <Alert>{errorMessage(cancel.error)}</Alert>}
        {!!orders.data?.length && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your orders
            </div>
            <div className="stagger flex flex-col gap-2">
              {orders.data.map((o) => {
                const [label, variant] = STATUS[o.status];
                return (
                  <div
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span>{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatMoney(o.totalMinor, o.currency)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={variant} dot>
                        {label}
                      </Badge>
                      {o.status === 'PENDING' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="hover:text-destructive"
                          loading={cancel.isPending && cancel.variables === o.id}
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(o.id)}
                        >
                          Cancel
                        </Button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
