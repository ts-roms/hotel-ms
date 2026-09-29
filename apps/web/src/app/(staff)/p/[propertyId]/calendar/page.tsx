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
import {
  CALENDAR_KINDS,
  type CalendarItem,
  EVENT_CATEGORIES,
  type HotelEvent,
} from '@hotel/contracts';
import { addDays, fromZoned, toZoned } from '@hotel/format';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  Input,
  Label,
  PageHeader,
  NativeSelect,
  Textarea,
  Toggle,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useProperty, usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel } from '@/lib/status';

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

/**
 * The property's unified calendar (spec §38–39, ADR-0026): arrivals, departures, shifts,
 * leave, birthdays, events and out-of-order rooms, each as far as the user may see them.
 * Managers schedule events here and invite staff.
 */
export default function CalendarPage() {
  return (
    <Suspense>
      <UnifiedCalendar />
    </Suspense>
  );
}

function UnifiedCalendar() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const property = useProperty(propertyId);
  const session = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const canManage = hasPermission(session.data, 'event.manage');
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
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('cal.show')}>
        {CALENDAR_KINDS.map((kind) => (
          <Toggle
            key={kind}
            variant="outline"
            size="sm"
            pressed={!hidden.has(kind)}
            onPressedChange={() => toggle(kind)}
            className={cn('gap-1.5 rounded-full px-3', hidden.has(kind) && 'opacity-40')}
          >
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: KIND_COLORS[kind] }}
            />
            {statusLabel(kind)}
          </Toggle>
        ))}
      </div>
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

function EventPanel({
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

function EventSummary({ event: e, timeZone }: { event: HotelEvent; timeZone: string }) {
  const start = toZoned(e.startsAt, timeZone);
  const end = toZoned(e.endsAt, timeZone);
  return (
    <div className="flex flex-col gap-2 text-sm">
      {e.status === 'CANCELLED' && <p className="text-destructive">{t('cal.cancelled')}</p>}
      <p>
        {statusLabel(e.category)}
        {e.location && ` · ${e.location}`}
      </p>
      <p className="tabular-nums">
        {e.allDay
          ? `${start.date} → ${addDays(end.date, -1)}`
          : `${start.date} ${start.time} – ${end.date === start.date ? '' : `${end.date} `}${end.time}`}
      </p>
      {e.description && <p className="whitespace-pre-wrap">{e.description}</p>}
      {e.organizerName && (
        <p className="text-muted-foreground">
          {t('cal.organizer')}: {e.organizerName}
        </p>
      )}
      {e.participants.length > 0 && (
        <p className="text-muted-foreground">
          {t('cal.participants')}: {e.participants.map((p) => p.name).join(', ')}
        </p>
      )}
    </div>
  );
}

function EventForm({
  propertyId,
  event: e,
  date,
  timeZone,
  people,
  onSaved,
}: {
  propertyId: string;
  event: HotelEvent | undefined;
  date?: string;
  timeZone: string;
  people: { membershipId: string; displayName: string }[];
  onSaved: () => Promise<void>;
}) {
  const pms = usePms(propertyId);
  const start = e ? toZoned(e.startsAt, timeZone) : { date: date ?? '', time: '09:00' };
  const end = e ? toZoned(e.endsAt, timeZone) : { date: date ?? '', time: '10:00' };
  const [title, setTitle] = useState(e?.title ?? '');
  const [category, setCategory] = useState<HotelEvent['category']>(e?.category ?? 'MEETING');
  const [allDay, setAllDay] = useState(e?.allDay ?? false);
  const [startDate, setStartDate] = useState(start.date);
  const [startTime, setStartTime] = useState(start.time);
  // All-day events store an exclusive end; the form shows the last day.
  const [endDate, setEndDate] = useState(e?.allDay ? addDays(end.date, -1) : end.date);
  const [endTime, setEndTime] = useState(end.time);
  const [location, setLocation] = useState(e?.location ?? '');
  const [description, setDescription] = useState(e?.description ?? '');
  const [guestVisible, setGuestVisible] = useState(e?.guestVisible ?? false);
  const [invited, setInvited] = useState<Set<string>>(
    new Set(e?.participants.map((p) => p.membershipId)),
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        category,
        allDay,
        location,
        description,
        guestVisible,
        startsAt: fromZoned(startDate, allDay ? '00:00' : startTime, timeZone),
        endsAt: allDay
          ? fromZoned(addDays(endDate, 1), '00:00', timeZone)
          : fromZoned(endDate, endTime, timeZone),
        participantMembershipIds: [...invited],
      };
      return e ? pms.updateEvent(e.id, e.version, body) : pms.createEvent(body);
    },
    onSuccess: onSaved,
  });
  const cancel = useMutation({
    mutationFn: () => pms.updateEvent(e!.id, e!.version, { status: 'CANCELLED' }),
    onSuccess: onSaved,
  });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    save.mutate();
  };
  const toggle = (membershipId: string) =>
    setInvited((current) => {
      const next = new Set(current);
      if (next.has(membershipId)) next.delete(membershipId);
      else next.add(membershipId);
      return next;
    });

  return (
    <form className="flex flex-col gap-3 text-sm" onSubmit={submit}>
      {(save.error || cancel.error) && <Alert>{errorMessage(save.error ?? cancel.error)}</Alert>}
      <Label className="flex flex-col gap-1">
        {t('cal.eventTitle')}
        <Input required maxLength={120} value={title} onChange={(v) => setTitle(v.target.value)} />
      </Label>
      <Label className="flex flex-col gap-1">
        {t('cal.categoryLabel')}
        <NativeSelect
          value={category}
          onChange={(v) => setCategory(v.target.value as HotelEvent['category'])}
        >
          {EVENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {statusLabel(c)}
            </option>
          ))}
        </NativeSelect>
      </Label>
      <Label className="flex items-center gap-2 font-normal">
        <Checkbox checked={allDay} onCheckedChange={(v) => setAllDay(v === true)} />
        {t('cal.allDay')}
      </Label>
      <div className="grid grid-cols-2 gap-2">
        <Label className="flex flex-col gap-1">
          {t('cal.starts')}
          <Input
            type="date"
            required
            value={startDate}
            onChange={(v) => {
              setStartDate(v.target.value);
              if (!endDate || endDate < v.target.value) setEndDate(v.target.value);
            }}
          />
        </Label>
        {!allDay && (
          <Label className="flex flex-col gap-1">
            {t('cal.at')}
            <Input
              type="time"
              required
              value={startTime}
              onChange={(v) => setStartTime(v.target.value)}
            />
          </Label>
        )}
        <Label className="flex flex-col gap-1">
          {t('cal.ends')}
          <Input
            type="date"
            required
            min={startDate}
            value={endDate}
            onChange={(v) => setEndDate(v.target.value)}
          />
        </Label>
        {!allDay && (
          <Label className="flex flex-col gap-1">
            {t('cal.at')}
            <Input
              type="time"
              required
              value={endTime}
              onChange={(v) => setEndTime(v.target.value)}
            />
          </Label>
        )}
      </div>
      <Label className="flex flex-col gap-1">
        {t('cal.location')}
        <Input maxLength={120} value={location} onChange={(v) => setLocation(v.target.value)} />
      </Label>
      <Label className="flex flex-col gap-1">
        {t('cal.description')}
        <Textarea
          maxLength={2000}
          value={description}
          onChange={(v) => setDescription(v.target.value)}
        />
      </Label>
      <Label className="flex items-center gap-2 font-normal">
        <Checkbox checked={guestVisible} onCheckedChange={(v) => setGuestVisible(v === true)} />
        {t('cal.guestVisible')}
      </Label>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium">{t('cal.participants')}</legend>
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2">
          {people.map((p) => (
            <Label key={p.membershipId} className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={invited.has(p.membershipId)}
                onCheckedChange={() => toggle(p.membershipId)}
              />
              {p.displayName}
            </Label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          {e ? t('cal.save') : t('cal.create')}
        </Button>
        {e && (
          <Button
            type="button"
            variant="ghost"
            className="hover:text-destructive"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t('cal.cancelEvent')}
          </Button>
        )}
      </div>
    </form>
  );
}
