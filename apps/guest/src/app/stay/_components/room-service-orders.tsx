'use client';

import type { Order } from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import { Alert, Badge, type BadgeVariant, Button } from '@hotel/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';

const STATUS_VARIANTS: Record<Order['status'], BadgeVariant> = {
  PENDING: 'info',
  CONFIRMED: 'primary',
  PREPARING: 'warning',
  READY: 'success',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'neutral',
  CANCELLED: 'danger',
};

/** The guest's room-service orders, with cancel while still pending. */
export function RoomServiceOrders({ orders }: { orders: Order[] | undefined }) {
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: api.cancelOrder,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  });
  return (
    <>
      {cancel.error && <Alert>{errorMessage(cancel.error)}</Alert>}
      {!!orders?.length && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('roomService.yourOrders')}
          </div>
          <div className="stagger flex flex-col gap-2">
            {orders.map((o) => {
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
                    <Badge variant={STATUS_VARIANTS[o.status]} dot>
                      {t(`roomService.status.${o.status}`)}
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
                        {t('roomService.cancel')}
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
