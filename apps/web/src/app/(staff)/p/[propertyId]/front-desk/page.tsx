'use client';

import type { FrontDeskItem } from '@hotel/contracts';
import { formatDate, formatMoney } from '@hotel/format';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Skeleton,
  SkeletonRow,
  StatCard,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, DoorOpen, LogIn, LogOut, Receipt } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { errorMessage } from '@/lib/errors';
import { type MessageKey, t } from '@/lib/i18n';
import { usePms, usePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel, statusVariant } from '@/lib/status';

/** `key` identifies which button started the action, so only that one shows a spinner. */
interface Action {
  key: string;
  run: () => Promise<unknown>;
}

export default function FrontDeskPage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const session = useSession();
  const queryClient = useQueryClient();
  const board = useQuery({ queryKey: ['front-desk', propertyId], queryFn: pms.frontDesk });
  const action = useMutation({
    mutationFn: (a: Action) => a.run(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['front-desk', propertyId] }),
  });
  const running = (key: string) => action.isPending && action.variables?.key === key;

  const can = (p: string) => hasPermission(session.data, p);

  const section = (
    title: MessageKey,
    icon: ReactNode,
    items: FrontDeskItem[] | undefined,
    kind: 'arrival' | 'inhouse' | 'departure',
  ) => (
    <Card>
      <CardHeader className="flex-row items-center gap-3 pb-4">
        <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
        <CardTitle className="text-base">{t(title)}</CardTitle>
        <Badge variant="primary" className="ml-auto tabular-nums">
          {items?.length ?? '–'}
        </Badge>
      </CardHeader>
      <CardContent className="stagger flex flex-col gap-2">
        {!items &&
          Array.from({ length: 2 }, (_, i) => <SkeletonRow key={i} className="border-dashed" />)}
        {items?.length === 0 && (
          <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
            {t('fd.none')}
          </p>
        )}
        {items?.map((item) => {
          const checkInKey = `in:${item.reservationRoomId}`;
          const checkOutKey = `out:${item.reservationRoomId}`;
          return (
            <div
              key={item.reservationRoomId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-accent/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar
                  name={`${item.guest.firstName} ${item.guest.lastName}`}
                  className="size-9 text-xs"
                />
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/p/${propertyId}/reservations/${item.reservationId}`}
                    className="truncate font-medium underline-offset-2 hover:text-primary hover:underline"
                  >
                    {item.guest.lastName}, {item.guest.firstName}
                  </Link>
                  <span className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{item.confirmationNo}</span> · {item.roomTypeCode} ·{' '}
                    {formatDate(item.arrivalDate)} → {formatDate(item.departureDate)}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {item.room ? (
                  <Badge variant={statusVariant(item.room.housekeepingStatus)} dot>
                    {item.room.number} · {statusLabel(item.room.housekeepingStatus)}
                  </Badge>
                ) : (
                  <Badge variant="danger">{t('res.unassigned')}</Badge>
                )}
                {item.balanceMinor !== null && (
                  <span
                    className={
                      item.balanceMinor === 0
                        ? 'tabular-nums text-muted-foreground'
                        : 'font-semibold tabular-nums'
                    }
                  >
                    {formatMoney(item.balanceMinor, item.currency)}
                  </span>
                )}
                {item.folioId && can('folio.read') && (
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/p/${propertyId}/folios/${item.folioId}`}>
                      <Receipt />
                      {t('fd.folio')}
                    </Link>
                  </Button>
                )}
                {kind === 'arrival' && can('stay.check_in') && (
                  <Button
                    size="sm"
                    loading={running(checkInKey)}
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({
                        key: checkInKey,
                        run: () => pms.checkIn(item.reservationId, item.reservationRoomId),
                      })
                    }
                  >
                    {!running(checkInKey) && <LogIn />}
                    {t('fd.checkIn')}
                  </Button>
                )}
                {kind !== 'arrival' && can('stay.check_out') && (
                  <Button
                    size="sm"
                    variant={kind === 'departure' ? 'default' : 'outline'}
                    loading={running(checkOutKey)}
                    disabled={action.isPending || item.balanceMinor !== 0}
                    title={item.balanceMinor !== 0 ? t('fd.balance') : undefined}
                    onClick={() =>
                      action.mutate({
                        key: checkOutKey,
                        run: () => pms.checkOut(item.reservationId, item.reservationRoomId),
                      })
                    }
                  >
                    {!running(checkOutKey) && <LogOut />}
                    {t('fd.checkOut')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );

  const d = board.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('fd.title')}
        description={
          d ? (
            <>
              {t('res.businessDate')} {formatDate(d.businessDate)}
            </>
          ) : (
            <Skeleton className="h-4 w-40" />
          )
        }
      />
      {(board.error || action.error) && <Alert>{errorMessage(board.error ?? action.error)}</Alert>}

      <div className="stagger grid grid-cols-3 gap-2 sm:gap-4" aria-busy={board.isPending}>
        <StatCard
          label={t('fd.departures')}
          value={d ? d.departures.length : <Skeleton className="mt-1 h-7 w-8" />}
          icon={<DoorOpen />}
          tone="warning"
        />
        <StatCard
          label={t('fd.arrivals')}
          value={d ? d.arrivals.length : <Skeleton className="mt-1 h-7 w-8" />}
          icon={<LogIn />}
          tone="info"
        />
        <StatCard
          label={t('fd.inHouse')}
          value={d ? d.inHouse.length : <Skeleton className="mt-1 h-7 w-8" />}
          icon={<BedDouble />}
          tone="success"
        />
      </div>

      <div className="stagger flex flex-col gap-4">
        {section('fd.departures', <DoorOpen />, d?.departures, 'departure')}
        {section('fd.arrivals', <LogIn />, d?.arrivals, 'arrival')}
        {section('fd.inHouse', <BedDouble />, d?.inHouse, 'inhouse')}
      </div>
    </div>
  );
}
