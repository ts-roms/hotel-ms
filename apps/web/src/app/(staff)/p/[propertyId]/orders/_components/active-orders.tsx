'use client';

import type { Order } from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingRegion,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useCan, usePms, usePropertyId } from '@/lib/property';
import { statusLabel, statusVariant } from '@/lib/status';

/** The property's active orders, with a cancel button for staff who may update them. */
export function ActiveOrders() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const can = useCan();
  const queryClient = useQueryClient();
  const recent = useQuery({
    queryKey: ['orders', propertyId],
    queryFn: () => pms.orders({ status: 'ACTIVE' }),
    refetchInterval: 15_000,
  });
  const cancel = useMutation({
    mutationFn: (o: Order) => pms.cancelOrder(o.id, o.version, t('fnb.cancelledByStaff')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orders', propertyId] }),
  });

  return (
    <>
      {cancel.error && <Alert>{errorMessage(cancel.error)}</Alert>}
      {recent.isPending && (
        <Card className="p-4">
          <LoadingRegion label={t('loading')}>
            <SkeletonTable rows={4} columns={5} />
          </LoadingRegion>
        </Card>
      )}
      {recent.data?.length === 0 && (
        <EmptyState icon={<ReceiptText />} title={t('fnb.noActiveOrders')} />
      )}
      {!!recent.data?.length && (
        <Card className="animate-fade-in overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>{t('fnb.order')}</TableHead>
                <TableHead>{t('fnb.outlet')}</TableHead>
                <TableHead>{t('fnb.room')}</TableHead>
                <TableHead>{t('fnb.status')}</TableHead>
                <TableHead className="text-right">{t('fnb.total')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody className="stagger">
              {recent.data.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.orderNo}</TableCell>
                  <TableCell>{o.outletName}</TableCell>
                  <TableCell>{o.roomNumber ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(o.status)} dot>
                      {statusLabel(o.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatMoney(o.totalMinor, o.currency)}
                  </TableCell>
                  <TableCell className="py-1.5 text-right">
                    {can('fnb.order.update') && (
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
