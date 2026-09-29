'use client';

import type { Order, OrderStatus } from '@hotel/contracts';
import { Button, Card, CardContent, cn } from '@hotel/ui';
import { Clock } from 'lucide-react';
import { t } from '@/lib/i18n';
import { timeSince } from '@/lib/time';
import { isLate, nextSteps, STATUS_STRIPE } from './board-config';

/** One order card on the kitchen board, with its next-step buttons. */
export function KitchenTicket({
  order: o,
  canUpdate,
  isStepping,
  stepPending,
  onStep,
  cancelling,
  cancelPending,
  onCancel,
}: {
  order: Order;
  canUpdate: boolean;
  /** Whether the step to this status was started from this ticket. */
  isStepping: (status: OrderStatus) => boolean;
  stepPending: boolean;
  onStep: (status: OrderStatus) => void;
  cancelling: boolean;
  cancelPending: boolean;
  onCancel: () => void;
}) {
  const late = isLate(o.createdAt);
  return (
    <Card
      className={cn(
        'relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-1',
        STATUS_STRIPE[o.status],
      )}
    >
      <CardContent className="flex flex-col gap-2 p-3 pl-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">
            {o.roomNumber ? t('roomNo', { number: o.roomNumber }) : o.orderNo}
          </span>
          <span
            className={cn(
              'flex items-center gap-1 text-xs tabular-nums',
              late ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            <Clock className="size-3" />
            {timeSince(o.createdAt)}
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
              {i.notes && <div className="text-xs italic text-warning">{i.notes}</div>}
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
                loading={isStepping(s.status)}
                disabled={stepPending}
                onClick={() => onStep(s.status)}
              >
                {t(s.label)}
              </Button>
            ))}
            {(o.status === 'PENDING' || o.status === 'CONFIRMED') && (
              <Button
                size="sm"
                variant="ghost"
                className="hover:text-destructive"
                loading={cancelling}
                disabled={cancelPending}
                onClick={onCancel}
              >
                {t('fnb.cancel')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
