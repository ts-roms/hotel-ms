'use client';

import type { Order, OrderStatus } from '@hotel/contracts';
import {
  Badge,
  Alert,
  Button,
  Card,
  CardContent,
  cn,
  EmptyState,
  LoadingRegion,
  PageHeader,
  NativeSelect,
  Skeleton,
  Toggle,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { createApiClient } from '@hotel/api-client';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { statusVariant } from '@/lib/status';

type Pms = ReturnType<ReturnType<typeof createApiClient>['pms']>;

const COLUMNS: { status: OrderStatus; label: Parameters<typeof t>[0] }[] = [
  { status: 'PENDING', label: 'fnb.new' },
  { status: 'CONFIRMED', label: 'fnb.confirmed' },
  { status: 'PREPARING', label: 'fnb.preparing' },
  { status: 'READY', label: 'fnb.ready' },
  { status: 'OUT_FOR_DELIVERY', label: 'fnb.outForDelivery' },
];

/** Left edge color of a ticket, by status. */
const STATUS_STRIPE: Partial<Record<OrderStatus, string>> = {
  PENDING: 'before:bg-warning',
  CONFIRMED: 'before:bg-primary',
  PREPARING: 'before:bg-warning',
  READY: 'before:bg-success',
  OUT_FOR_DELIVERY: 'before:bg-info',
};

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

/**
 * Kitchen display (blueprint §14): live over Server-Sent Events, with a slow poll as backup.
 * Used by the staff app and by shared kitchen devices (ADR-0020), each with its own client.
 */
export function KitchenBoard({
  propertyId,
  pms,
  can,
  headerExtra,
}: {
  propertyId: string;
  pms: Pms;
  can: (permission: string) => boolean;
  headerExtra?: React.ReactNode;
}) {
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
  /** Only the button that started the change shows a spinner. */
  const stepping = (o: Order, status: OrderStatus) =>
    step.isPending && step.variables?.order.id === o.id && step.variables.status === status;
  const canUpdate = can('fnb.order.update');
  const loading = outlets.isPending || (!!outlet && orders.isPending);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('fnb.kitchen')}
        actions={
          <>
            {headerExtra}
            <Badge variant={live ? 'success' : 'neutral'}>
              <span
                aria-hidden="true"
                className={cn('size-1.5 rounded-full bg-current', live && 'animate-pulse')}
              />
              {live ? t('fnb.live') : t('fnb.polling')}
            </Badge>
            <NativeSelect
              className="h-9 w-auto"
              aria-label={t('fnb.outlet')}
              value={outlet}
              onChange={(e) => setOutletId(e.target.value)}
            >
              {outlets.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </>
        }
      />
      {(orders.error || step.error || cancel.error) && (
        <Alert>{errorMessage(orders.error ?? step.error ?? cancel.error)}</Alert>
      )}
      {outlets.data?.length === 0 && <EmptyState icon={<ChefHat />} title={t('fnb.noOutlets')} />}

      {outlets.data?.length !== 0 && (
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map((column) => {
            const list = orders.data?.filter((o) => o.status === column.status) ?? [];
            return (
              <section
                key={column.status}
                className="flex flex-col gap-2 rounded-xl bg-muted/40 p-2"
                aria-label={t(column.label)}
              >
                <h2 className="flex items-center justify-between px-1.5 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(column.label)}
                  <Badge variant={statusVariant(column.status)} className="tabular-nums">
                    {loading ? '–' : list.length}
                  </Badge>
                </h2>
                {loading && (
                  <LoadingRegion label={t('loading')} className="flex flex-col gap-2">
                    <Card className="flex flex-col gap-2 p-3">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </Card>
                  </LoadingRegion>
                )}
                {!loading && list.length === 0 && (
                  <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                    {t('fnb.emptyColumn')}
                  </p>
                )}
                <div className="stagger flex flex-col gap-2">
                  {list.map((o) => {
                    const age = minutesAgo(o.createdAt);
                    return (
                      <Card
                        key={o.id}
                        className={cn(
                          'relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-1',
                          STATUS_STRIPE[o.status],
                        )}
                      >
                        <CardContent className="flex flex-col gap-2 p-3 pl-4 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">
                              {o.roomNumber ? `${t('fnb.room')} ${o.roomNumber}` : o.orderNo}
                            </span>
                            <span
                              className={cn(
                                'flex items-center gap-1 text-xs tabular-nums',
                                age >= 20
                                  ? 'font-medium text-destructive'
                                  : 'text-muted-foreground',
                              )}
                            >
                              <Clock className="size-3" />
                              {age} {t('fnb.minutes')}
                            </span>
                          </div>
                          <ul className="flex flex-col gap-1">
                            {o.items.map((i) => (
                              <li key={i.id}>
                                <span className="mr-1 inline-flex min-w-6 justify-center rounded bg-muted px-1 text-xs font-semibold tabular-nums">
                                  {i.quantity}×
                                </span>
                                {i.name}
                                {i.modifiers.length > 0 && (
                                  <span className="text-muted-foreground">
                                    {' '}
                                    · {i.modifiers.map((m) => m.name).join(', ')}
                                  </span>
                                )}
                                {i.notes && (
                                  <div className="text-xs italic text-warning">{i.notes}</div>
                                )}
                              </li>
                            ))}
                          </ul>
                          {o.notes && (
                            <p className="rounded-md bg-warning/10 px-2 py-1 text-xs italic text-warning">
                              {o.notes}
                            </p>
                          )}
                          {canUpdate && (
                            <div className="flex flex-wrap gap-1">
                              {nextSteps(o).map((s) => (
                                <Button
                                  key={s.status}
                                  size="sm"
                                  loading={stepping(o, s.status)}
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
                                  className="hover:text-destructive"
                                  loading={cancel.isPending && cancel.variables?.id === o.id}
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
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {can('fnb.menu.availability') && outlet && (
        <SoldOut propertyId={propertyId} pms={pms} outletId={outlet} />
      )}
    </div>
  );
}

function SoldOut({
  propertyId,
  pms,
  outletId,
}: {
  propertyId: string;
  pms: Pms;
  outletId: string;
}) {
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
    <Card className="animate-fade-in">
      <CardContent className="flex flex-wrap items-center gap-2 pt-5 text-sm">
        <span className="font-medium">{t('fnb.soldOut')}</span>
        {menu.isPending &&
          Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        {menu.data?.categories.flatMap((c) =>
          c.items
            .filter((i) => !i.archived)
            .map((i) => (
              <Toggle
                key={i.id}
                variant="outline"
                size="sm"
                pressed={!i.available}
                disabled={toggle.isPending}
                onPressedChange={() => toggle.mutate({ id: i.id, available: !i.available })}
                className="rounded-full px-3 text-muted-foreground active:scale-95 disabled:opacity-60 hover:border-ring/40 hover:bg-card hover:text-foreground data-[state=on]:border-destructive/30 data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive data-[state=on]:line-through"
              >
                {i.name}
              </Toggle>
            )),
        )}
      </CardContent>
    </Card>
  );
}
