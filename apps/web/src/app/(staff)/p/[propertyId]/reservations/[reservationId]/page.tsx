'use client';

import type { Reservation, ReservationRoom } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

export default function ReservationPage() {
  const { propertyId, reservationId } = useParams<{ propertyId: string; reservationId: string }>();
  const pms = usePms(propertyId);
  const session = useSession();
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
  const action = useMutation({
    mutationFn: (fn: () => Promise<Reservation>) => fn(),
    onSuccess: update,
  });
  const [reason, setReason] = useState('');

  const r = reservation.data;
  if (reservation.error) return <Alert>{errorMessage(reservation.error)}</Alert>;
  if (!r) return <p className="text-muted-foreground">{t('loading')}</p>;

  const canUpdate = hasPermission(session.data, 'reservation.update');
  const canCancel = hasPermission(session.data, 'reservation.cancel');
  const hasUpcoming = r.rooms.some((l) => l.status === 'RESERVED');

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link
        href={`/p/${propertyId}/reservations`}
        className="text-sm text-muted-foreground underline"
      >
        {t('common.back')}
      </Link>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>
                {r.booker.firstName} {r.booker.lastName}
              </CardTitle>
              <CardDescription className="font-mono">{r.confirmationNo}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge>{r.status}</Badge>
              <strong>{formatMoney(r.totalMinor, r.currency)}</strong>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <span>
            {t('res.source')}: {r.source.replace('_', ' ').toLowerCase()}
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
            line.folioId && hasPermission(session.data, 'folio.read')
              ? `/p/${propertyId}/folios/${line.folioId}`
              : null
          }
          onCheckIn={
            hasPermission(session.data, 'stay.check_in')
              ? () => action.mutate(() => pms.checkIn(r.id, line.id))
              : null
          }
          onCheckOut={
            hasPermission(session.data, 'stay.check_out')
              ? () => action.mutate(() => pms.checkOut(r.id, line.id))
              : null
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
              disabled={!reason.trim() || action.isPending}
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

function RoomLine({
  line,
  currency,
  rooms,
  canUpdate,
  canCancel,
  busy,
  onAssign,
  onUnassign,
  onCancel,
  folioHref,
  onCheckIn,
  onCheckOut,
}: {
  line: ReservationRoom;
  currency: string;
  rooms: { id: string; number: string; blockedToday: boolean }[];
  canUpdate: boolean;
  canCancel: boolean;
  busy: boolean;
  onAssign: (roomId: string) => void;
  onUnassign: () => void;
  onCancel: () => void;
  folioHref: string | null;
  onCheckIn: (() => void) | null;
  onCheckOut: (() => void) | null;
}) {
  const [roomId, setRoomId] = useState('');
  const upcoming = line.status === 'RESERVED';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {line.roomTypeCode} · {line.ratePlanCode}
          </CardTitle>
          <Badge>{line.status.replace('_', ' ')}</Badge>
        </div>
        <CardDescription>
          {formatDate(line.arrivalDate)} → {formatDate(line.departureDate)} · {line.nights.length}{' '}
          {t('res.nights')} · {line.adults} {t('res.adults').toLowerCase()}
          {line.children ? `, ${line.children} ${t('res.children').toLowerCase()}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ul className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
          {line.nights.map((n) => (
            <li key={n.date} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{formatDate(n.date)}</span>
              <span>{formatMoney(n.amountMinor, currency)}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {t('res.room')}: <strong>{line.assignedRoom?.number ?? t('res.unassigned')}</strong>
          </span>
          {canUpdate && upcoming && (
            <>
              <Select
                className="w-auto"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                aria-label={t('res.room')}
              >
                <option value="">—</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id} disabled={room.blockedToday}>
                    {room.number}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="outline"
                disabled={!roomId || busy}
                onClick={() => onAssign(roomId)}
              >
                {t('res.assign')}
              </Button>
              {line.assignedRoom && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={onUnassign}>
                  {t('res.unassign')}
                </Button>
              )}
            </>
          )}
          {canCancel && upcoming && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
              {t('res.cancelRoom')}
            </Button>
          )}
          {onCheckIn && upcoming && line.assignedRoom && (
            <Button size="sm" disabled={busy} onClick={onCheckIn}>
              {t('fd.checkIn')}
            </Button>
          )}
          {folioHref && (
            <Button size="sm" variant="outline" asChild>
              <Link href={folioHref}>{t('fd.folio')}</Link>
            </Button>
          )}
          {onCheckOut && line.status === 'IN_HOUSE' && (
            <Button size="sm" disabled={busy} onClick={onCheckOut}>
              {t('fd.checkOut')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
