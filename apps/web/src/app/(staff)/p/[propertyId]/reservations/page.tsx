'use client';

import { Alert, Badge, Button, Card, CardContent, Input } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePms, useProperty, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

export default function ReservationsPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const property = useProperty(propertyId);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const reservations = useQuery({
    queryKey: ['reservations', propertyId, q],
    queryFn: () => pms.reservations({ q: q || undefined, limit: 50 }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t('res.title')}</h1>
          {property.data && (
            <p className="text-sm text-muted-foreground">
              {property.data.name} · {t('res.businessDate')}{' '}
              {formatDate(property.data.currentBusinessDate)}
            </p>
          )}
        </div>
        {hasPermission(session.data, 'reservation.create') && (
          <Button asChild>
            <Link href={`/p/${propertyId}/reservations/new`}>{t('res.new')}</Link>
          </Button>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search.trim());
        }}
      >
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('res.search')}
          aria-label={t('res.search')}
        />
        <Button type="submit" variant="outline">
          {t('common.search')}
        </Button>
      </form>

      {reservations.error && <Alert>{errorMessage(reservations.error)}</Alert>}
      {reservations.isPending && <p className="text-muted-foreground">{t('loading')}</p>}
      {reservations.data?.items.length === 0 && (
        <p className="text-muted-foreground">{t('res.empty')}</p>
      )}

      <ul className="flex flex-col gap-2">
        {reservations.data?.items.map((r) => (
          <li key={r.id}>
            <Link href={`/p/${propertyId}/reservations/${r.id}`}>
              <Card className="transition-colors hover:bg-accent">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-6">
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {r.booker.lastName}, {r.booker.firstName}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {r.confirmationNo}
                    </span>
                  </div>
                  <div className="flex flex-col text-sm">
                    {r.rooms.map((line) => (
                      <span key={line.id}>
                        {formatDate(line.arrivalDate)} → {formatDate(line.departureDate)} ·{' '}
                        {line.roomTypeCode}
                        {line.assignedRoom ? ` · ${line.assignedRoom.number}` : ''}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{formatMoney(r.totalMinor, r.currency)}</span>
                    <Badge>
                      {r.status === 'CANCELLED' ? t('res.cancelled') : r.rooms[0]?.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
