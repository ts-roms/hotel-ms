'use client';

import { EVENT_CATEGORIES, type HotelEvent } from '@hotel/contracts';
import { addDays, fromZoned, toZoned } from '@hotel/format';
import { Alert, Button, Checkbox, Input, Label, NativeSelect, Textarea } from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { statusLabel } from '@/lib/status';

export function EventForm({
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
