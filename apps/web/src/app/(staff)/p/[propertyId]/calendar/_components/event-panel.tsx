'use client';

import { type HotelEvent } from '@hotel/contracts';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from '@hotel/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { EventForm } from './event-form';
import { EventSummary } from './event-summary';

export function EventPanel({
  propertyId,
  eventId,
  date,
  timeZone,
  canManage,
  onClose,
}: {
  propertyId: string;
  eventId: string | null;
  date?: string;
  timeZone: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const event = useQuery({
    queryKey: ['event', propertyId, eventId],
    queryFn: () => pms.event(eventId!),
    enabled: !!eventId,
  });
  const people = useQuery({
    queryKey: ['event-people', propertyId],
    queryFn: pms.eventPeople,
    enabled: canManage,
  });
  const panel = useRef<HTMLDivElement>(null);
  // Below the calendar on narrower screens: bring the panel into view when it opens.
  const e = event.data;
  const ready = !eventId || !!e;
  useEffect(() => {
    if (ready) panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [ready]);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['calendar', propertyId] }),
      queryClient.invalidateQueries({ queryKey: ['event', propertyId] }),
    ]);

  return (
    <div ref={panel}>
      {eventId && !e ? (
        event.error && <Alert>{errorMessage(event.error)}</Alert>
      ) : (
        <EventCard
          propertyId={propertyId}
          event={e}
          date={date}
          timeZone={timeZone}
          canManage={canManage}
          people={people.data ?? []}
          onSaved={refresh}
          onClose={onClose}
        />
      )}
    </div>
  );
}

function EventCard({
  propertyId,
  event: e,
  date,
  timeZone,
  canManage,
  people,
  onSaved,
  onClose,
}: {
  propertyId: string;
  event: HotelEvent | undefined;
  date?: string;
  timeZone: string;
  canManage: boolean;
  people: { membershipId: string; displayName: string }[];
  onSaved: () => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          {e ? e.title : t('cal.newEvent')}
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('cal.close')}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {canManage && (!e || e.status === 'SCHEDULED') ? (
          <EventForm
            propertyId={propertyId}
            event={e}
            date={date}
            timeZone={timeZone}
            people={people}
            onSaved={async () => {
              await onSaved();
              onClose();
            }}
          />
        ) : (
          e && <EventSummary event={e} timeZone={timeZone} />
        )}
      </CardContent>
    </Card>
  );
}
