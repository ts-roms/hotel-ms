'use client';

import type { CoverageGap, RecurringShiftsResult } from '@hotel/contracts';
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
  Notice,
  NativeSelect,
  Toggle,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat, TriangleAlert, Trash2, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';

/** Recurring shifts, minimum staffing and coverage gaps (spec §35, ADR-0028). */

/** Monday first, as the schedule grid; values are 0 = Sunday … 6 = Saturday. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const weekdayName = (d: number) =>
  // 2023-01-01 was a Sunday.
  new Date(Date.UTC(2023, 0, 1 + d)).toLocaleString([], { weekday: 'short', timeZone: 'UTC' });

function WeekdayPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={t('sched.weekdays')}>
      {WEEKDAYS.map((d) => {
        const on = value.includes(d);
        return (
          <Toggle
            key={d}
            variant="outline"
            size="sm"
            pressed={on}
            onPressedChange={() => onChange(on ? value.filter((x) => x !== d) : [...value, d])}
            className="h-7 rounded-md px-2 font-normal data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90"
          >
            {weekdayName(d)}
          </Toggle>
        );
      })}
    </div>
  );
}

const SKIP_REASON: Record<RecurringShiftsResult['skipped'][number]['reason'], string> = {
  NOT_ASSIGNED: 'sched.skip.NOT_ASSIGNED',
  ON_LEAVE: 'sched.skip.ON_LEAVE',
  OVERLAP: 'sched.skip.OVERLAP',
};

/** The same shift for several people on chosen weekdays, created as drafts. */
export function RecurringShifts({
  employees,
  from,
  onCreated,
}: {
  employees: { id: string; name: string; departmentName: string }[];
  from: string;
  onCreated: () => void;
}) {
  const propertyId = useRoutePropertyId()!;
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
          <WeekdayPicker value={weekdays} onChange={setWeekdays} />
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

/** Understaffed windows of the week shown. */
export function CoverageGaps({ gaps }: { gaps: CoverageGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <Alert className="border-warning/40 bg-warning/10 text-foreground">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4 text-warning" />
        {t('sched.understaffed')}
      </p>
      <ul className="mt-1 flex flex-col gap-0.5 text-sm">
        {gaps.map((g) => (
          <li key={`${g.requirementId}:${g.date}`}>
            {formatDate(g.date)} · {g.departmentName} {g.startTime}–{g.endTime}:{' '}
            <strong>
              {g.scheduled} / {g.required}
            </strong>{' '}
            {t('sched.scheduled')}
            {g.published < g.scheduled && (
              <span className="text-muted-foreground">
                {' '}
                ({g.published} {t('sched.publishedShort')})
              </span>
            )}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/** Minimum staffing per department and time window. */
export function StaffingRequirements({ canManage }: { canManage: boolean }) {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const requirements = useQuery({
    queryKey: ['staffing-requirements', propertyId],
    queryFn: pms.staffingRequirements,
  });
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: api.hr.departments,
    enabled: canManage,
  });
  const [form, setForm] = useState({
    departmentId: '',
    weekdays: [1, 2, 3, 4, 5, 6, 0] as number[],
    startTime: '08:00',
    endTime: '17:00',
    minStaff: '2',
  });
  const departmentId = form.departmentId || departments.data?.find((d) => !d.archived)?.id || '';
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['staffing-requirements', propertyId] });
    void queryClient.invalidateQueries({ queryKey: ['coverage', propertyId] });
  };
  const create = useMutation({
    mutationFn: () =>
      pms.createStaffingRequirement({
        departmentId,
        weekdays: form.weekdays,
        startTime: form.startTime,
        endTime: form.endTime,
        minStaff: Number(form.minStaff),
      }),
    onSuccess: refresh,
  });
  const archive = useMutation({
    mutationFn: (id: string) => pms.archiveStaffingRequirement(id),
    onSuccess: refresh,
  });
  if (!canManage && !requirements.data?.length) return null;

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-primary" />
          {t('sched.minimumStaffing')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {requirements.data?.length === 0 && (
          <p className="text-muted-foreground">{t('sched.noRequirements')}</p>
        )}
        {requirements.data?.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <span>
              <strong>{r.departmentName}</strong> · {r.startTime}–{r.endTime} ·{' '}
              {WEEKDAYS.filter((d) => r.weekdays.includes(d))
                .map(weekdayName)
                .join(', ')}
            </span>
            <span className="flex items-center gap-2">
              {t('sched.atLeast')} <strong>{r.minStaff}</strong>
              {canManage && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('hrx.remove')}
                  disabled={archive.isPending}
                  onClick={() => archive.mutate(r.id)}
                >
                  <Trash2 />
                </Button>
              )}
            </span>
          </div>
        ))}
        {canManage && (
          <form
            className="flex flex-col gap-2 border-t pt-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                className="w-auto"
                aria-label={t('hr.department')}
                value={departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              >
                {departments.data
                  ?.filter((d) => !d.archived)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </NativeSelect>
              <Input
                type="time"
                className="w-auto"
                aria-label={t('cal.starts')}
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              />
              <span>–</span>
              <Input
                type="time"
                className="w-auto"
                aria-label={t('cal.ends')}
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              />
              <Input
                type="number"
                min={1}
                max={200}
                className="w-20"
                aria-label={t('sched.minStaff')}
                value={form.minStaff}
                onChange={(e) => setForm({ ...form, minStaff: e.target.value })}
              />
              <span className="text-muted-foreground">{t('sched.people').toLowerCase()}</span>
            </div>
            <WeekdayPicker
              value={form.weekdays}
              onChange={(weekdays) => setForm({ ...form, weekdays })}
            />
            {create.error && <Alert>{errorMessage(create.error)}</Alert>}
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="self-start"
              loading={create.isPending}
              disabled={!departmentId || form.weekdays.length === 0 || !Number(form.minStaff)}
            >
              {t('sched.addRequirement')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
