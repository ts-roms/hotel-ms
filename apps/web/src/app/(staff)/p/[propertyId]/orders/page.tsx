'use client';

import type { MenuItem, Order, OrderItemInput, StaffOrderRequest } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

interface CartLine {
  item: MenuItem;
  quantity: number;
  modifierIds: string[];
}

/** Order taking for outlets and phone room service (blueprint §14). */
export default function OrdersPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const queryClient = useQueryClient();
  const outlets = useQuery({ queryKey: ['outlets', propertyId], queryFn: pms.outlets });
  const rooms = useQuery({ queryKey: ['rooms', propertyId], queryFn: pms.rooms });
  const [outletId, setOutletId] = useState('');
  const outlet = outletId || outlets.data?.find((o) => o.active)?.id || '';
  const menu = useQuery({
    queryKey: ['menu', propertyId, outlet],
    queryFn: () => pms.menu(outlet),
    enabled: !!outlet,
  });
  const recent = useQuery({
    queryKey: ['orders', propertyId],
    queryFn: () => pms.orders({ status: 'ACTIVE' }),
    refetchInterval: 15_000,
  });

  const [cart, setCart] = useState<CartLine[]>([]);
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
      setCart([]);
      setNotes('');
      setAttemptKey(crypto.randomUUID());
      return queryClient.invalidateQueries({ queryKey: ['orders', propertyId] });
    },
  });
  const cancel = useMutation({
    mutationFn: (o: Order) => pms.cancelOrder(o.id, o.version, t('fnb.cancelledByStaff')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orders', propertyId] }),
  });

  const currency = menu.data?.currency ?? 'PHP';
  const lineTotal = (l: CartLine) =>
    (l.item.priceMinor +
      l.item.modifierGroups
        .flatMap((g) => g.modifiers)
        .filter((m) => l.modifierIds.includes(m.id))
        .reduce((s, m) => s + m.priceMinor, 0)) *
    l.quantity;
  const total = cart.reduce((s, l) => s + lineTotal(l), 0);
  const add = (item: MenuItem) =>
    setCart([
      ...cart,
      {
        item,
        quantity: 1,
        // Pre-select the first option of each required group.
        modifierIds: item.modifierGroups
          .filter((g) => g.minSelect > 0)
          .flatMap((g) => g.modifiers.slice(0, g.minSelect).map((m) => m.id)),
      },
    ]);
  const update = (index: number, change: Partial<CartLine>) =>
    setCart(cart.map((l, i) => (i === index ? { ...l, ...change } : l)));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('fnb.orders')}</h1>
      {hasPermission(session.data, 'fnb.order.create') && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <Select
                aria-label={t('fnb.outlet')}
                value={outlet}
                onChange={(e) => {
                  setOutletId(e.target.value);
                  setCart([]);
                }}
              >
                {outlets.data
                  ?.filter((o) => o.active)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </Select>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {menu.data?.categories.map((c) => (
                <div key={c.id}>
                  <div className="mb-1 font-medium">{c.name}</div>
                  <div className="flex flex-wrap gap-2">
                    {c.items
                      .filter((i) => !i.archived)
                      .map((i) => (
                        <Button
                          key={i.id}
                          size="sm"
                          variant="outline"
                          disabled={!i.available}
                          onClick={() => add(i)}
                        >
                          {i.name} · {formatMoney(i.priceMinor, currency)}
                        </Button>
                      ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('fnb.newOrder')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {cart.length === 0 && <p className="text-muted-foreground">{t('fnb.emptyCart')}</p>}
              {cart.map((l, index) => (
                <div key={index} className="flex flex-col gap-1 border-t pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <span>{l.item.name}</span>
                    <span className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        className="w-16"
                        aria-label={t('fnb.quantity')}
                        value={l.quantity}
                        onChange={(e) =>
                          update(index, { quantity: Math.max(1, Number(e.target.value) || 1) })
                        }
                      />
                      <span className="w-24 text-right tabular-nums">
                        {formatMoney(lineTotal(l), currency)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('fnb.remove')}
                        onClick={() => setCart(cart.filter((_, i) => i !== index))}
                      >
                        ×
                      </Button>
                    </span>
                  </div>
                  {l.item.modifierGroups.map((g) => (
                    <div key={g.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{g.name}</span>
                      {g.modifiers.map((m) => {
                        const on = l.modifierIds.includes(m.id);
                        return (
                          <label key={m.id} className="flex items-center gap-1">
                            <input
                              type={g.maxSelect === 1 ? 'radio' : 'checkbox'}
                              name={`${index}-${g.id}`}
                              checked={on}
                              onChange={() => {
                                const others = l.modifierIds.filter(
                                  (id) => !g.modifiers.some((x) => x.id === id),
                                );
                                const inGroup = l.modifierIds.filter((id) =>
                                  g.modifiers.some((x) => x.id === id),
                                );
                                const next =
                                  g.maxSelect === 1
                                    ? [m.id]
                                    : on
                                      ? inGroup.filter((id) => id !== m.id)
                                      : [...inGroup, m.id];
                                update(index, { modifierIds: [...others, ...next] });
                              }}
                            />
                            {m.name}
                            {m.priceMinor > 0 && ` +${formatMoney(m.priceMinor, currency)}`}
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Select
                  className="w-auto"
                  aria-label={t('fnb.chargeMethod')}
                  value={chargeMethod}
                  onChange={(e) => setChargeMethod(e.target.value as typeof chargeMethod)}
                >
                  <option value="ROOM_CHARGE">{t('fnb.roomCharge')}</option>
                  <option value="PAY_ON_DELIVERY">{t('fnb.payOnDelivery')}</option>
                  <option value="PAY_AT_OUTLET">{t('fnb.payAtOutlet')}</option>
                </Select>
                <Select
                  className="w-auto"
                  aria-label={t('fnb.room')}
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                >
                  <option value="">{t('fnb.noRoom')}</option>
                  {rooms.data
                    ?.filter((r) => !r.archived)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.number}
                      </option>
                    ))}
                </Select>
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
                disabled={cart.length === 0 || place.isPending}
                onClick={() => place.mutate()}
              >
                {t('fnb.placeOrder')} · {formatMoney(total, currency)}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {cancel.error && <Alert>{errorMessage(cancel.error)}</Alert>}
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-2">{t('fnb.order')}</th>
            <th>{t('fnb.outlet')}</th>
            <th>{t('fnb.room')}</th>
            <th>{t('fnb.status')}</th>
            <th className="text-right">{t('fnb.total')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {recent.data?.map((o) => (
            <tr key={o.id} className="border-t">
              <td className="py-2 font-mono">{o.orderNo}</td>
              <td>{o.outletName}</td>
              <td>{o.roomNumber ?? '—'}</td>
              <td>
                <Badge>{o.status.toLowerCase().replaceAll('_', ' ')}</Badge>
              </td>
              <td className="text-right tabular-nums">{formatMoney(o.totalMinor, o.currency)}</td>
              <td className="text-right">
                {hasPermission(session.data, 'fnb.order.update') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(o)}
                  >
                    {t('fnb.cancel')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
