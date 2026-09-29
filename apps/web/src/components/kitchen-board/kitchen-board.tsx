'use client';

import type { Order, OrderStatus } from '@hotel/contracts';
import {
  Badge,
  Alert,
  Card,
  cn,
  EmptyState,
  LoadingRegion,
  PageHeader,
  NativeSelect,
  Skeleton,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { statusVariant } from '@/lib/status';
import { COLUMNS, type Pms } from './board-config';
import { KitchenTicket } from './kitchen-ticket';
import { SoldOut } from './sold-out';

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
                  {list.map((o) => (
                    <KitchenTicket
                      key={o.id}
                      order={o}
                      canUpdate={canUpdate}
                      isStepping={(status) => stepping(o, status)}
                      stepPending={step.isPending}
                      onStep={(status) => step.mutate({ order: o, status })}
                      cancelling={cancel.isPending && cancel.variables?.id === o.id}
                      cancelPending={cancel.isPending}
                      onCancel={() => cancel.mutate(o)}
                    />
                  ))}
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
