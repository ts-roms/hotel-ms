'use client';

import type { FrontDeskItem } from '@hotel/contracts';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { type MessageKey, t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

export default function FrontDeskPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const queryClient = useQueryClient();
  const board = useQuery({ queryKey: ['front-desk', propertyId], queryFn: pms.frontDesk });
  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['front-desk', propertyId] }),
  });

  const can = (p: string) => hasPermission(session.data, p);

  const section = (
    title: MessageKey,
    items: FrontDeskItem[] | undefined,
    kind: 'arrival' | 'inhouse' | 'departure',
  ) => (
    <Card>
      <CardHeader>
        <CardTitle>
          {t(title)} <span className="text-muted-foreground">({items?.length ?? 0})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {items?.length === 0 && <p className="text-sm text-muted-foreground">{t('fd.none')}</p>}
        {items?.map((item) => (
          <div
            key={item.reservationRoomId}
            className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"
          >
            <div className="flex flex-col">
              <Link
                href={`/p/${propertyId}/reservations/${item.reservationId}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {item.guest.lastName}, {item.guest.firstName}
              </Link>
              <span className="text-muted-foreground">
                {item.confirmationNo} · {item.roomTypeCode} · {formatDate(item.arrivalDate)} →{' '}
                {formatDate(item.departureDate)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {item.room ? (
                <Badge>
                  {item.room.number} · {item.room.housekeepingStatus.toLowerCase()}
                </Badge>
              ) : (
                <Badge className="border-destructive text-destructive">{t('res.unassigned')}</Badge>
              )}
              {item.balanceMinor !== null && (
                <span className={item.balanceMinor === 0 ? 'text-muted-foreground' : 'font-medium'}>
                  {formatMoney(item.balanceMinor, item.currency)}
                </span>
              )}
              {item.folioId && can('folio.read') && (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/p/${propertyId}/folios/${item.folioId}`}>{t('fd.folio')}</Link>
                </Button>
              )}
              {kind === 'arrival' && can('stay.check_in') && (
                <Button
                  size="sm"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate(() => pms.checkIn(item.reservationId, item.reservationRoomId))
                  }
                >
                  {t('fd.checkIn')}
                </Button>
              )}
              {kind !== 'arrival' && can('stay.check_out') && (
                <Button
                  size="sm"
                  variant={kind === 'departure' ? 'default' : 'outline'}
                  disabled={action.isPending || item.balanceMinor !== 0}
                  title={item.balanceMinor !== 0 ? t('fd.balance') : undefined}
                  onClick={() =>
                    action.mutate(() => pms.checkOut(item.reservationId, item.reservationRoomId))
                  }
                >
                  {t('fd.checkOut')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('fd.title')}</h1>
        {board.data && (
          <p className="text-sm text-muted-foreground">
            {t('res.businessDate')} {formatDate(board.data.businessDate)}
          </p>
        )}
      </div>
      {(board.error || action.error) && <Alert>{errorMessage(board.error ?? action.error)}</Alert>}
      {section('fd.departures', board.data?.departures, 'departure')}
      {section('fd.arrivals', board.data?.arrivals, 'arrival')}
      {section('fd.inHouse', board.data?.inHouse, 'inhouse')}
    </div>
  );
}
