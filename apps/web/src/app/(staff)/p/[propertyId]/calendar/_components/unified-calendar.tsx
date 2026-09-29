'use client';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import interactionPlugin from '@fullcalendar/react/interaction';
import listPlugin from '@fullcalendar/react/list';
import classicThemePlugin from '@fullcalendar/react/themes/classic';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/classic/theme.css';
import '@fullcalendar/react/themes/classic/palette.css';
import { CALENDAR_KINDS, type CalendarItem } from '@hotel/contracts';
import { addDays } from '@hotel/format';
import { Alert, Button, Card, CardContent, ChipGroup, cn, FilterChip, PageHeader } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useCan, usePms, useProperty, usePropertyId } from '@/lib/property';
import { enumLabel } from '@/lib/status';
import { EventPanel } from './event-panel';

type Kind = (typeof CALENDAR_KINDS)[number];

const KIND_COLORS: Record<Kind, string> = {
  ARRIVAL: '#16a34a',
  DEPARTURE: '#ea580c',
  SHIFT: '#2563eb',
  LEAVE: '#9333ea',
  BIRTHDAY: '#db2777',
  EVENT: '#0d9488',
  OUT_OF_ORDER: '#dc2626',
};

export function UnifiedCalendar() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const property = useProperty(propertyId);
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const canManage = can('event.manage');
  const [hidden, setHidden] = useState<Set<Kind>>(new Set());
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [editing, setEditing] = useState<{ eventId: string | null; date?: string } | null>(
    params.get('event') ? { eventId: params.get('event') } : null,
  );
  const timeZone = property.data?.timezone;

  const calendar = useQuery({
    queryKey: ['calendar', propertyId, range?.from, range?.to],
    queryFn: () => pms.calendar(range!.from, range!.to),
    enabled: !!range,
  });
  const items = (calendar.data?.items ?? []).filter((i) => !hidden.has(i.kind));

  const toggle = (kind: Kind) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const open = (item: CalendarItem) => {
    if (item.kind === 'EVENT') setEditing({ eventId: item.id.slice('event:'.length) });
    else if (item.link) router.push(item.link);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('cal.title')}
        description={t('cal.hint')}
        actions={
          canManage && (
            <Button onClick={() => setEditing({ eventId: null })}>{t('cal.newEvent')}</Button>
          )
        }
      />
      <ChipGroup label={t('cal.show')}>
        {CALENDAR_KINDS.map((kind) => (
          <FilterChip
            key={kind}
            pressed={!hidden.has(kind)}
            onPressedChange={() => toggle(kind)}
            className={cn('gap-1.5', hidden.has(kind) && 'opacity-40')}
          >
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: KIND_COLORS[kind] }}
            />
            {enumLabel('calendarKind', kind)}
          </FilterChip>
        ))}
      </ChipGroup>
      {calendar.error && <Alert>{errorMessage(calendar.error)}</Alert>}
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <Card>
          <CardContent className="hotel-calendar pt-4">
            {timeZone && (
              <FullCalendar
                plugins={[
                  classicThemePlugin,
                  dayGridPlugin,
                  timeGridPlugin,
                  listPlugin,
                  interactionPlugin,
                ]}
                timeZone={timeZone}
                initialView="dayGridMonth"
                headerToolbar={{
                  start: 'prev,next today',
                  center: 'title',
                  end: 'dayGridMonth,timeGridWeek,listWeek',
                }}
                height="auto"
                dayMaxEvents={4}
                nowIndicator
                datesSet={(info) =>
                  setRange({
                    from: info.startStr.slice(0, 10),
                    to: addDays(info.endStr.slice(0, 10), -1),
                  })
                }
                events={items.map((i) => ({
                  id: i.id,
                  title: i.title,
                  start: i.start,
                  end: i.end,
                  allDay: i.allDay,
                  color: KIND_COLORS[i.kind],
                  extendedProps: { item: i },
                }))}
                eventClick={(info) => {
                  info.jsEvent.preventDefault();
                  open(info.event.extendedProps.item as CalendarItem);
                }}
                dateClick={(info) =>
                  canManage && setEditing({ eventId: null, date: info.dateStr.slice(0, 10) })
                }
              />
            )}
          </CardContent>
        </Card>
        {editing && timeZone && (
          <EventPanel
            key={editing.eventId ?? `new:${editing.date ?? ''}`}
            propertyId={propertyId}
            eventId={editing.eventId}
            date={editing.date}
            timeZone={timeZone}
            canManage={canManage}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}
