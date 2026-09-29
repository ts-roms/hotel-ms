import type { Order, OrderStatus } from '@hotel/contracts';
import type { createApiClient } from '@hotel/api-client';
import { type MessageKey } from '@/lib/i18n';
import { elapsed } from '@hotel/format';

export type Pms = ReturnType<ReturnType<typeof createApiClient>['pms']>;

export const COLUMNS: { status: OrderStatus; label: MessageKey }[] = [
  { status: 'PENDING', label: 'fnb.new' },
  { status: 'CONFIRMED', label: 'fnb.confirmed' },
  { status: 'PREPARING', label: 'fnb.preparing' },
  { status: 'READY', label: 'fnb.ready' },
  { status: 'OUT_FOR_DELIVERY', label: 'fnb.outForDelivery' },
];

/** Left edge color of a ticket, by status. */
export const STATUS_STRIPE: Partial<Record<OrderStatus, string>> = {
  PENDING: 'before:bg-warning',
  CONFIRMED: 'before:bg-primary',
  PREPARING: 'before:bg-warning',
  READY: 'before:bg-success',
  OUT_FOR_DELIVERY: 'before:bg-info',
};

export function nextSteps(order: Order): { status: OrderStatus; label: MessageKey }[] {
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

/** A ticket waiting this long (or longer) is flagged. */
const LATE_MINUTES = 20;
export const isLate = (iso: string) => {
  const e = elapsed(iso);
  return (
    e.unit === 'hours' || e.unit === 'days' || (e.unit === 'minutes' && e.value >= LATE_MINUTES)
  );
};
