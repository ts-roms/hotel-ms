'use client';

import { formatDate, formatTime, localDate } from '@hotel/format';
import { CardContent } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { MapPin, PartyPopper } from 'lucide-react';
import { Section } from '@/components/section';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

/** What's on at the hotel in the next 30 days (ADR-0026); hidden when nothing is planned. */
export function HotelEvents({ timeZone }: { timeZone: string }) {
  const events = useQuery({ queryKey: ['events'], queryFn: api.events, retry: false });
  if (!events.data?.length) return null;
  const day = (iso: string) => formatDate(localDate(iso, timeZone));
  const time = (iso: string) => formatTime(iso, { timeZone });
  return (
    <Section icon={<PartyPopper />} title={t('events.title')}>
      <CardContent className="flex flex-col gap-3">
        {events.data.map((e) => (
          <div key={e.id} className="flex flex-col gap-0.5 rounded-xl border p-3">
            <p className="font-medium">{e.title}</p>
            <p className="text-sm text-muted-foreground">
              {day(e.startsAt)}
              {e.allDay ? '' : ` · ${time(e.startsAt)} – ${time(e.endsAt)}`}
            </p>
            {e.location && (
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="size-3.5" />
                {e.location}
              </p>
            )}
            {e.description && <p className="mt-1 whitespace-pre-wrap text-sm">{e.description}</p>}
          </div>
        ))}
      </CardContent>
    </Section>
  );
}
