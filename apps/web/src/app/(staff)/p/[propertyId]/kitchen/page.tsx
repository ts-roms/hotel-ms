'use client';

import type { Order, OrderStatus } from '@hotel/contracts';
import { Alert, Badge, Button, Card, CardContent, cn, Notice, Select } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

const COLUMNS: { status: OrderStatus; label: Parameters<typeof t>[0] }[] = [
  { status: 'PENDING', label: 'fnb.new' },
  { status: 'CONFIRMED', label: 'fnb.confirmed' },
  { status: 'PREPARING', label: 'fnb.preparing' },
  { status: 'READY', label: 'fnb.ready' },
  { status: 'OUT_FOR_DELIVERY', label: 'fnb.outForDelivery' },
];

function nextSteps(order: Order): { status: OrderStatus; label: Parameters<typeof t>[0] }[] {
  switch (order.status) {
    case 'PENDING':
      return [{ status: 'CONFIRMED', label: 'fnb.accept' }];
    case 'CONFIRMED':
      return [{ status: 'PREPARING', label: 'fnb.start' }];
    case 'PREPARING':
      return [{ status: 'READY', label: 'fnb.markReady' }];
    case 'READY':
      return order.roomNumber
        ? [
            { status: 'OUT_FOR_DELIVERY', label: 'fnb.sendOut' },
            { status: 'DELIVERED', label: 'fnb.delivered' },
          ]
        : [{ status: 'DELIVERED', label: 'fnb.served' }];
    case 'OUT_FOR_DELIVERY':
      return [{ status: 'DELIVERED', label: 'fnb.delivered' }];
    default:
      return [];
  }
}

const minutesAgo = (iso: string) =>
  Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));

/** Kitchen display (blueprint §14): live over Server-Sent Events, with a slow poll as backup. */
export default function KitchenPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const queryClient = useQueryClient();
  const outlets = useQuery({ queryKey: ['outlets', propertyId], queryFn: pms.outlets });
  const [outletId, setOutletId] = useState('');
  const outlet = outletId || outlets.data?.find((o) => o.active)?.id || '';
  const [live, setLive] = useState(false);

  const orders = useQuery({
    queryKey: ['kitchen', propertyId, outlet],
    queryFn: () => pms.orders({ outletId: outlet, status: 'ACTIVE' }),
    enabled: !!outlet,
    refetchInterval: live ? 60_000 : 10_000,
  });

  useEffect(() => {
    if (!outlet) return;
    const source = new EventSource(pms.orderStreamUrl(outlet), { withCredentials: true });
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    source.addEventListener('order', () => {
      void queryClient.invalidateQueries({ queryKey: ['kitchen', propertyId, outlet] });
    });
    return () => source.close();
  }, [outlet, propertyId, pms, queryClient]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['kitchen', propertyId, outlet] });
  const step = useMutation({
    mutationFn: (input: { order: Order; status: OrderStatus }) =>
      pms.setOrderStatus(input.order.id, input.order.version, input.status),
    onSettled: refresh,
  });
  const cancel = useMutation({
    mutationFn: (order: Order) =>
      pms.cancelOrder(order.id, order.version, t('fnb.cancelledByKitchen')),
    onSettled: refresh,
  });
  const canUpdate = hasPermission(session.data, 'fnb.order.update');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('fnb.kitchen')}</h1>
        <div className="flex items-center gap-2">
          <Badge className={live ? 'text-green-600' : 'text-muted-foreground'}>
            {live ? t('fnb.live') : t('fnb.polling')}
          </Badge>
          <Select
            className="w-auto"
            aria-label={t('fnb.outlet')}
            value={outlet}
            onChange={(e) => setOutletId(e.target.value)}
          >
            {outlets.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {(orders.error || step.error || cancel.error) && (
        <Alert>{errorMessage(orders.error ?? step.error ?? cancel.error)}</Alert>
      )}
      {outlets.data?.length === 0 && <Notice>{t('fnb.noOutlets')}</Notice>}

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {COLUMNS.map((column) => {
          const list = orders.data?.filter((o) => o.status === column.status) ?? [];
          return (
            <section key={column.status} className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                {t(column.label)} ({list.length})
              </h2>
              {list.map((o) => (
                <Card
                  key={o.id}
                  className={cn(
                    'border-l-4',
                    o.status === 'PENDING' ? 'border-yellow-500/70' : 'border-primary/60',
                  )}
                >
                  <CardContent className="flex flex-col gap-2 pt-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">
                        {o.roomNumber ? `${t('fnb.room')} ${o.roomNumber}` : o.orderNo}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {minutesAgo(o.createdAt)} {t('fnb.minutes')}
                      </span>
                    </div>
                    <ul className="flex flex-col gap-1">
                      {o.items.map((i) => (
                        <li key={i.id}>
                          <strong>{i.quantity}×</strong> {i.name}
                          {i.modifiers.length > 0 && (
                            <span className="text-muted-foreground">
                              {' '}
                              · {i.modifiers.map((m) => m.name).join(', ')}
                            </span>
                          )}
                          {i.notes && <div className="text-xs italic">{i.notes}</div>}
                        </li>
                      ))}
                    </ul>
                    {o.notes && <p className="text-xs italic">{o.notes}</p>}
                    {canUpdate && (
                      <div className="flex flex-wrap gap-1">
                        {nextSteps(o).map((s) => (
                          <Button
                            key={s.status}
                            size="sm"
                            disabled={step.isPending}
                            onClick={() => step.mutate({ order: o, status: s.status })}
                          >
                            {t(s.label)}
                          </Button>
                        ))}
                        {(o.status === 'PENDING' || o.status === 'CONFIRMED') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={cancel.isPending}
                            onClick={() => cancel.mutate(o)}
                          >
                            {t('fnb.cancel')}
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </section>
          );
        })}
      </div>

      {hasPermission(session.data, 'fnb.menu.availability') && outlet && (
        <SoldOut outletId={outlet} />
      )}
    </div>
  );
}

function SoldOut({ outletId }: { outletId: string }) {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const menu = useQuery({
    queryKey: ['menu', propertyId, outletId],
    queryFn: () => pms.menu(outletId),
  });
  const toggle = useMutation({
    mutationFn: (input: { id: string; available: boolean }) =>
      pms.setItemAvailability(input.id, input.available),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['menu', propertyId, outletId] }),
  });
  return (
    <Card>
      <CardContent className="flex flex-wrap gap-2 pt-4 text-sm">
        <span className="font-medium">{t('fnb.soldOut')}</span>
        {menu.data?.categories.flatMap((c) =>
          c.items
            .filter((i) => !i.archived)
            .map((i) => (
              <Button
                key={i.id}
                size="sm"
                variant={i.available ? 'outline' : 'destructive'}
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ id: i.id, available: !i.available })}
              >
                {i.name}
              </Button>
            )),
        )}
      </CardContent>
    </Card>
  );
}
