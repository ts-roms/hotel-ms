'use client';

import type { ReservationRoom } from '@hotel/contracts';
import { formatDate, formatMoney } from '@hotel/format';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  NativeSelect,
} from '@hotel/ui';
import { LogIn, LogOut, Receipt } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { t } from '@/lib/i18n';
import { statusLabel, statusVariant } from '@/lib/status';

export function RoomLine({
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
  extra,
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
  extra?: ReactNode;
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
          <Badge variant={statusVariant(line.status)} dot>
            {statusLabel(line.status)}
          </Badge>
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
            <li key={n.date} className="flex justify-between gap-2 border-b border-dashed py-1">
              <span className="text-muted-foreground">{formatDate(n.date)}</span>
              <span className="tabular-nums">{formatMoney(n.amountMinor, currency)}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {t('res.room')}: <strong>{line.assignedRoom?.number ?? t('res.unassigned')}</strong>
          </span>
          {canUpdate && upcoming && (
            <>
              <NativeSelect
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
              </NativeSelect>
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
              <LogIn />
              {t('fd.checkIn')}
            </Button>
          )}
          {folioHref && (
            <Button size="sm" variant="outline" asChild>
              <Link href={folioHref}>
                <Receipt />
                {t('fd.folio')}
              </Link>
            </Button>
          )}
          {onCheckOut && line.status === 'IN_HOUSE' && (
            <Button size="sm" disabled={busy} onClick={onCheckOut}>
              <LogOut />
              {t('fd.checkOut')}
            </Button>
          )}
        </div>
        {extra}
      </CardContent>
    </Card>
  );
}
