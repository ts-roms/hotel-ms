'use client';

import { addDays, formatDate } from '@hotel/format';
import {
  Alert,
  Button,
  Card,
  cn,
  EmptyState,
  LoadingRegion,
  PageHeader,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useProperty, useRoutePropertyId } from '@/lib/property';

const DAYS = 14;

export default function AvailabilityPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const property = useProperty(propertyId);
  const [offset, setOffset] = useState(0);

  const start = property.data ? addDays(property.data.currentBusinessDate, offset) : undefined;
  const availability = useQuery({
    queryKey: ['availability', propertyId, start],
    queryFn: () => pms.availability(start!, addDays(start!, DAYS)),
    enabled: !!start,
    // Keep the grid on screen while paging to the next two weeks.
    placeholderData: keepPreviousData,
  });
  const paging = availability.isPlaceholderData;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('avail.title')}
        description={t('avail.legend')}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset <= 0 || paging}
              onClick={() => setOffset(Math.max(0, offset - DAYS))}
            >
              <ChevronLeft />
              {t('avail.earlier')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={paging}
              onClick={() => setOffset(offset + DAYS)}
            >
              {t('avail.later')}
              <ChevronRight />
            </Button>
          </div>
        }
      />

      {availability.error && <Alert>{errorMessage(availability.error)}</Alert>}
      {!availability.data && !availability.error && (
        <Card className="p-4">
          <LoadingRegion label={t('loading')}>
            <SkeletonTable rows={4} columns={8} />
          </LoadingRegion>
        </Card>
      )}
      {availability.data?.roomTypes.length === 0 && (
        <EmptyState icon={<CalendarRange />} title={t('avail.noRoomTypes')} />
      )}
      {availability.data && availability.data.roomTypes.length > 0 && (
        <Card
          className={cn(
            'animate-fade-in overflow-hidden transition-opacity duration-300',
            paging && 'opacity-50',
          )}
          aria-busy={paging}
        >
          <Table className="border-collapse">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="sticky left-0 z-10 bg-card">{t('res.roomType')}</TableHead>
                {availability.data.roomTypes[0]?.nights.map((n) => (
                  <TableHead
                    key={n.date}
                    className="text-center font-medium normal-case tracking-normal"
                  >
                    {formatDate(n.date)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {availability.data.roomTypes.map((rt) => (
                <TableRow key={rt.roomTypeId}>
                  <TableHead scope="row" className="sticky left-0 z-10 bg-card font-mono">
                    {rt.code}
                  </TableHead>
                  {rt.nights.map((n) => (
                    <TableCell
                      key={n.date}
                      className="p-1.5 text-center"
                      title={`${n.sold} / ${n.blocked}`}
                    >
                      <div
                        className={cn(
                          'rounded-lg px-2 py-1.5 transition-transform duration-150 hover:scale-105',
                          n.available === 0
                            ? 'bg-destructive/15 text-destructive'
                            : n.available <= 1
                              ? 'bg-warning/15 text-warning'
                              : 'bg-success/10 text-success',
                        )}
                      >
                        <div className="font-semibold tabular-nums">{n.available}</div>
                        <div className="text-[11px] tabular-nums opacity-70">
                          {n.sold}/{n.blocked}
                        </div>
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
