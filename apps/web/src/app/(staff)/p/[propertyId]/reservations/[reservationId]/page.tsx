'use client';

import type { Reservation } from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DocumentTitle,
  Input,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Mail } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useCan, usePms } from '@/lib/property';
import { enumLabel, statusLabel, statusVariant } from '@/lib/status';
import { GuestMessage } from './_components/guest-message';
import { DetailSkeleton } from './_components/reservation-skeleton';
import { RoomLine } from './_components/room-line';
import { useAction } from '@/lib/use-action';

export default function ReservationPage() {
  const { propertyId, reservationId } = useParams<{ propertyId: string; reservationId: string }>();
  const pms = usePms(propertyId);
  const can = useCan();
  const queryClient = useQueryClient();
  const reservation = useQuery({
    queryKey: ['reservation', propertyId, reservationId],
    queryFn: () => pms.reservation(reservationId),
  });
  const rooms = useQuery({ queryKey: ['rooms', propertyId], queryFn: pms.rooms });

  const update = (data: Reservation) => {
    queryClient.setQueryData(['reservation', propertyId, reservationId], data);
    void queryClient.invalidateQueries({ queryKey: ['reservations', propertyId] });
  };
  const action = useAction<Reservation>({
    onSuccess: update,
  });
  const [reason, setReason] = useState('');
  const portalLink = useMutation({ mutationFn: () => pms.sendGuestPortalLink(reservationId) });

  const r = reservation.data;
  if (reservation.error) return <Alert>{errorMessage(reservation.error)}</Alert>;
  if (!r) return <DetailSkeleton />;

  const canUpdate = can('reservation.update');
  const canCancel = can('reservation.cancel');
  const hasUpcoming = r.rooms.some((l) => l.status === 'RESERVED');

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link
        href={`/p/${propertyId}/reservations`}
        className="group flex items-center gap-1 self-start text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-1" />
        {t('common.back')}
      </Link>
      <DocumentTitle title={`${r.confirmationNo} · ${r.booker.firstName} ${r.booker.lastName}`} />
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <Avatar name={`${r.booker.firstName} ${r.booker.lastName}`} className="size-12" />
              <div className="flex flex-col gap-1">
                <CardTitle>
                  {r.booker.firstName} {r.booker.lastName}
                </CardTitle>
                <CardDescription className="font-mono">{r.confirmationNo}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={statusVariant(r.status)} dot>
                {statusLabel(r.status)}
              </Badge>
              <strong className="text-lg tabular-nums">
                {formatMoney(r.totalMinor, r.currency)}
              </strong>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <span>
            <span className="text-muted-foreground">{t('res.source')}:</span>{' '}
            {enumLabel('bookingSource', r.source)}
          </span>
          {r.specialRequests && (
            <span>
              {t('res.specialRequests')}: {r.specialRequests}
            </span>
          )}
          {r.cancelReason && (
            <span>
              {t('res.cancelled')}: {r.cancelReason}
            </span>
          )}
          {r.status === 'CONFIRMED' && can('guest_portal.invite') && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                loading={portalLink.isPending}
                disabled={!r.booker.email}
                title={r.booker.email ? undefined : t('res.portalNoEmail')}
                onClick={() => portalLink.mutate()}
              >
                {!portalLink.isPending && <Mail />}
                {t('res.sendPortalLink')}
              </Button>
              {portalLink.isSuccess && (
                <span className="flex animate-fade-in items-center gap-1 text-success">
                  <Check className="size-4" />
                  {t('res.portalLinkSentTo', { email: r.booker.email ?? '' })}
                </span>
              )}
              {portalLink.error && (
                <span className="text-destructive">{errorMessage(portalLink.error)}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {action.error && <Alert>{errorMessage(action.error)}</Alert>}

      {r.rooms.map((line) => (
        <RoomLine
          key={line.id}
          line={line}
          currency={r.currency}
          rooms={(rooms.data ?? []).filter(
            (room) => room.roomTypeId === line.roomTypeId && !room.archived,
          )}
          canUpdate={canUpdate}
          canCancel={canCancel && r.rooms.length > 1}
          busy={action.isPending}
          onAssign={(roomId) => action.mutate(() => pms.assignRoom(r.id, line.id, { roomId }))}
          onUnassign={() => action.mutate(() => pms.unassignRoom(r.id, line.id))}
          onCancel={() =>
            reason && action.mutate(() => pms.cancelReservationRoom(r.id, line.id, reason))
          }
          folioHref={
            line.folioId && can('folio.read') ? `/p/${propertyId}/folios/${line.folioId}` : null
          }
          onCheckIn={
            can('stay.check_in') ? () => action.mutate(() => pms.checkIn(r.id, line.id)) : null
          }
          onCheckOut={
            can('stay.check_out') ? () => action.mutate(() => pms.checkOut(r.id, line.id)) : null
          }
          extra={
            r.status === 'CONFIRMED' &&
            (line.status === 'RESERVED' || line.status === 'IN_HOUSE') &&
            can('guest_portal.invite') ? (
              <GuestMessage propertyId={propertyId} reservationId={r.id} lineId={line.id} />
            ) : null
          }
        />
      ))}

      {canCancel && hasUpcoming && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 pt-6">
            <Input
              className="flex-1"
              placeholder={t('res.cancelReason')}
              aria-label={t('res.cancelReason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant="destructive"
              loading={action.isPending}
              disabled={!reason.trim()}
              onClick={() => action.mutate(() => pms.cancelReservation(r.id, reason))}
            >
              {t('res.cancel')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
