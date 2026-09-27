'use client';

import { Alert, Button, cn } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDate } from '@/lib/format';
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
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t('avail.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('avail.legend')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset <= 0}
            onClick={() => setOffset(Math.max(0, offset - DAYS))}
          >
            {t('avail.earlier')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOffset(offset + DAYS)}>
            {t('avail.later')}
          </Button>
        </div>
      </div>

      {availability.error && <Alert>{errorMessage(availability.error)}</Alert>}
      {availability.data && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 bg-card p-2 text-left">{t('res.roomType')}</th>
                {availability.data.roomTypes[0]?.nights.map((n) => (
                  <th
                    key={n.date}
                    className="whitespace-nowrap p-2 text-center font-normal text-muted-foreground"
                  >
                    {formatDate(n.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {availability.data.roomTypes.map((rt) => (
                <tr key={rt.roomTypeId} className="border-t">
                  <th className="sticky left-0 bg-card p-2 text-left font-medium">{rt.code}</th>
                  {rt.nights.map((n) => (
                    <td
                      key={n.date}
                      className={cn(
                        'p-2 text-center',
                        n.available === 0
                          ? 'bg-destructive/15 text-destructive'
                          : n.available <= 1
                            ? 'bg-accent'
                            : '',
                      )}
                      title={`${n.sold} / ${n.blocked}`}
                    >
                      <div className="font-semibold">{n.available}</div>
                      <div className="text-xs text-muted-foreground">
                        {n.sold}/{n.blocked}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
