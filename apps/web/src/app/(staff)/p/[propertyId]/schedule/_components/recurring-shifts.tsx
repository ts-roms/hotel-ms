'use client';

import type { RecurringShiftsResult } from '@hotel/contracts';
import { addDays, formatDate } from '@hotel/format';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  NativeSelect,
  Notice,
  WeekdayPicker,
} from '@hotel/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, usePropertyId } from '@/lib/property';

const SKIP_REASON: Record<RecurringShiftsResult['skipped'][number]['reason'], string> = {
  NOT_ASSIGNED: 'sched.skip.NOT_ASSIGNED',
  ON_LEAVE: 'sched.skip.ON_LEAVE',
  OVERLAP: 'sched.skip.OVERLAP',
};

/** The same shift for several people on chosen weekdays, created as drafts (spec §35, ADR-0028). */
export function RecurringShifts({
  employees,
  from,
  onCreated,
}: {
  employees: { id: string; name: string; departmentName: string }[];
  from: string;
  onCreated: () => void;
}) {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const templates = useQuery({
    queryKey: ['shift-templates', propertyId],
    queryFn: pms.shiftTemplates,
  });
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [range, setRange] = useState({ from, to: addDays(from, 27) });
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const template = templateId || templates.data?.[0]?.id || '';
  const create = useMutation({
    mutationFn: () =>
      pms.createRecurringShifts({
        employeeIds: people,
        from: range.from,
        to: range.to,
        weekdays,
        templateId: template,
      }),
    onSuccess: () => {
      setPeople([]);
      onCreated();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  if (!open)
    return (
      <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
        <Repeat />
        {t('sched.recurring')}
      </Button>
    );
  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Repeat className="size-4 text-primary" />
            {t('sched.recurring')}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t('cal.close')}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3 text-sm" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Label className="flex flex-col gap-1">
              {t('hr.shiftTemplate')}
              <NativeSelect value={template} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.data?.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} {tpl.startTime}–{tpl.endTime}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label className="flex flex-col gap-1">
              {t('sched.from')}
              <Input
                type="date"
                required
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
              />
            </Label>
            <Label className="flex flex-col gap-1">
              {t('sched.to')}
              <Input
                type="date"
                required
                min={range.from}
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
              />
            </Label>
          </div>
          <WeekdayPicker label={t('sched.weekdays')} value={weekdays} onChange={setWeekdays} />
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-medium">{t('sched.people')}</legend>
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
              {employees.map((e) => (
                <Label key={e.id} className="flex items-center gap-2 font-normal">
                  <Checkbox
                    checked={people.includes(e.id)}
                    onCheckedChange={() =>
                      setPeople(
                        people.includes(e.id)
                          ? people.filter((p) => p !== e.id)
                          : [...people, e.id],
                      )
                    }
                  />
                  {e.name}
                  <span className="text-xs text-muted-foreground">{e.departmentName}</span>
                </Label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-muted-foreground">{t('sched.recurringHint')}</p>
          {create.error && <Alert>{errorMessage(create.error)}</Alert>}
          {create.data && (
            <Notice>
              {create.data.created} {t('sched.created')}
              {create.data.skipped.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {create.data.skipped.slice(0, 10).map((s) => (
                    <li key={`${s.employeeId}:${s.date}`}>
                      {s.employeeName}, {formatDate(s.date)}:{' '}
                      {t(SKIP_REASON[s.reason] as 'sched.skip.OVERLAP')}
                    </li>
                  ))}
                  {create.data.skipped.length > 10 && (
                    <li>
                      +{create.data.skipped.length - 10} {t('sched.more')}
                    </li>
                  )}
                </ul>
              )}
            </Notice>
          )}
          <Button
            type="submit"
            className="self-start"
            loading={create.isPending}
            disabled={people.length === 0 || weekdays.length === 0 || !template}
          >
            {t('sched.createDrafts')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
