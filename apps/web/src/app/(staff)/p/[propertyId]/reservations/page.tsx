'use client';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  cn,
  EmptyState,
  Input,
  LoadingRegion,
  PageHeader,
  Skeleton,
  SkeletonRow,
} from '@hotel/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Inbox, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePms, useProperty, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel, statusVariant } from '@/lib/status';

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
    // Keep the current list on screen while a new search loads.
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('res.title')}
        description={
          property.data ? (
            <>
              {property.data.name} · {t('res.businessDate')}{' '}
              {formatDate(property.data.currentBusinessDate)}
            </>
          ) : (
            <Skeleton className="h-4 w-56" />
          )
        }
        actions={
          hasPermission(session.data, 'reservation.create') && (
            <Button asChild>
              <Link href={`/p/${propertyId}/reservations/new`}>
                <Plus />
                {t('res.new')}
              </Link>
            </Button>
          )
        }
      />

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search.trim());
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('res.search')}
            aria-label={t('res.search')}
          />
        </div>
        <Button type="submit" variant="outline" loading={reservations.isPlaceholderData}>
          {t('common.search')}
        </Button>
      </form>

      {reservations.error && <Alert>{errorMessage(reservations.error)}</Alert>}
      {reservations.isPending && (
        <LoadingRegion label={t('loading')} className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </LoadingRegion>
      )}
      {reservations.data?.items.length === 0 && (
        <EmptyState icon={<Inbox />} title={t('res.empty')} />
      )}

      <ul
        className={cn(
          'stagger flex flex-col gap-2 transition-opacity',
          reservations.isPlaceholderData && 'opacity-60',
        )}
      >
        {reservations.data?.items.map((r) => {
          const status = r.status === 'CANCELLED' ? 'CANCELLED' : r.rooms[0]?.status;
          return (
            <li key={r.id}>
              <Link
                href={`/p/${propertyId}/reservations/${r.id}`}
                className="hover-lift group flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 shadow-sm shadow-black/3"
              >
                <Avatar name={`${r.booker.firstName} ${r.booker.lastName}`} />
                <div className="flex min-w-40 flex-1 flex-col">
                  <span className="font-medium">
                    {r.booker.lastName}, {r.booker.firstName}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.confirmationNo}
                  </span>
                </div>
                <div className="flex flex-col text-sm text-muted-foreground">
                  {r.rooms.map((line) => (
                    <span key={line.id}>
                      {formatDate(line.arrivalDate)} → {formatDate(line.departureDate)} ·{' '}
                      <span className="text-foreground">{line.roomTypeCode}</span>
                      {line.assignedRoom ? ` · ${line.assignedRoom.number}` : ''}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMoney(r.totalMinor, r.currency)}
                  </span>
                  {status && (
                    <Badge variant={statusVariant(status)} dot>
                      {status === 'CANCELLED' ? t('res.cancelled') : statusLabel(status)}
                    </Badge>
                  )}
                  <ArrowRight className="size-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary" />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
