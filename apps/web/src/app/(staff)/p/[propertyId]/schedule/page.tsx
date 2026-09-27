'use client';

import type { ShiftWarning } from '@hotel/contracts';
import { Alert, Badge, Button, Card, CardContent, cn, Input, Notice, Select } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDate } from '@/lib/format';
import { mondayOf, today, weekDays } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

/** Weekly staff schedule (blueprint §13.3): plan in drafts, then publish. */
export default function SchedulePage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const queryClient = useQueryClient();
  const [monday, setMonday] = useState(() => mondayOf(today()));
  const days = weekDays(monday);
  const sunday = days[6]!;
  const canManage = hasPermission(session.data, 'schedule.manage');

  const schedule = useQuery({
    queryKey: ['schedule', propertyId, monday],
    queryFn: () => pms.schedule(monday, sunday),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['schedule', propertyId] });
  const publish = useMutation({
    mutationFn: () => pms.publishSchedule(monday, sunday),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: (s: { id: string; version: number }) => pms.cancelShift(s.id, s.version),
    onSettled: refresh,
  });

  const data = schedule.data;
  const drafts = data?.shifts.filter((s) => s.status === 'DRAFT').length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('hr.schedule')}</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setMonday(addDays(monday, -7))}>
            ←
          </Button>
          <span className="text-sm">
            {formatDate(monday)} – {formatDate(sunday)}
          </span>
          <Button size="sm" variant="outline" onClick={() => setMonday(addDays(monday, 7))}>
            →
          </Button>
          {canManage && (
            <Button
              size="sm"
              disabled={drafts === 0 || publish.isPending}
              onClick={() => publish.mutate()}
            >
              {t('hr.publish')} ({drafts})
            </Button>
          )}
        </div>
      </div>
      {publish.isSuccess && (
        <Notice>
          {publish.data.published} {t('hr.published')}
        </Notice>
      )}
      {(schedule.error || publish.error || cancel.error) && (
        <Alert>{errorMessage(schedule.error ?? publish.error ?? cancel.error)}</Alert>
      )}

      {canManage && data && <NewShift employees={data.employees} days={days} onCreated={refresh} />}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="py-2 pr-2">{t('hr.employee')}</th>
              {days.map((d) => (
                <th key={d} className="px-1 py-2">
                  {formatDate(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.employees.map((e) => (
              <tr key={e.id} className="border-t align-top">
                <td className="py-2 pr-2">
                  <div className="font-medium">{e.name}</div>
                  <div className="text-xs text-muted-foreground">{e.departmentName}</div>
                </td>
                {days.map((d) => {
                  const shifts = data.shifts.filter((s) => s.employeeId === e.id && s.date === d);
                  const away = data.unavailability.find(
                    (u) => u.employeeId === e.id && u.from <= d && u.to >= d,
                  );
                  return (
                    <td key={d} className="px-1 py-2">
                      {away && <Badge className="mb-1 text-muted-foreground">{away.label}</Badge>}
                      {shifts.map((s) => (
                        <div
                          key={s.id}
                          className={cn(
                            'mb-1 rounded border px-1.5 py-1 text-xs',
                            s.status === 'DRAFT' ? 'border-dashed' : 'border-primary/60 bg-accent',
                          )}
                        >
                          <div className="tabular-nums">
                            {s.startTime}–{s.endTime}
                          </div>
                          {s.status === 'DRAFT' && (
                            <div className="text-muted-foreground">{t('hr.draft')}</div>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              className="text-muted-foreground underline"
                              onClick={() => cancel.mutate(s)}
                            >
                              {t('hr.cancel')}
                            </button>
                          )}
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {data?.employees.length === 0 && <p className="text-muted-foreground">{t('hr.noStaff')}</p>}
      </div>

      {hasPermission(session.data, 'birthday.read') && <Birthdays />}
    </div>
  );
}

function NewShift({
  employees,
  days,
  onCreated,
}: {
  employees: { id: string; name: string }[];
  days: string[];
  onCreated: () => void;
}) {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const templates = useQuery({
    queryKey: ['shift-templates', propertyId],
    queryFn: pms.shiftTemplates,
  });
  const [form, setForm] = useState({ employeeId: '', date: days[0]!, templateId: '' });
  const [warnings, setWarnings] = useState<ShiftWarning[]>([]);
  const create = useMutation({
    mutationFn: () =>
      pms.createShift({
        employeeId: form.employeeId || employees[0]!.id,
        date: form.date,
        templateId: form.templateId || templates.data![0]!.id,
        departmentId: null,
        notes: '',
      }),
    onSuccess: (shift) => {
      setWarnings(shift.warnings);
      onCreated();
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4">
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2" noValidate>
          <Select
            className="w-auto"
            aria-label={t('hr.employee')}
            value={form.employeeId}
            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <Input
            type="date"
            className="w-auto"
            aria-label={t('hr.date')}
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
          <Select
            className="w-auto"
            aria-label={t('hr.shiftTemplate')}
            value={form.templateId}
            onChange={(e) => setForm({ ...form, templateId: e.target.value })}
          >
            {templates.data?.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} {tpl.startTime}–{tpl.endTime}
              </option>
            ))}
          </Select>
          <Button
            type="submit"
            disabled={employees.length === 0 || !templates.data?.length || create.isPending}
          >
            {t('hr.addShift')}
          </Button>
        </form>
        {create.error && <Alert>{errorMessage(create.error)}</Alert>}
        {warnings.map((w) => (
          <Notice key={w.code}>{w.message}</Notice>
        ))}
      </CardContent>
    </Card>
  );
}

function Birthdays() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const birthdays = useQuery({ queryKey: ['birthdays', propertyId], queryFn: pms.birthdays });
  if (!birthdays.data?.length) return null;
  const month = (m: number) =>
    new Date(Date.UTC(2000, m - 1, 1)).toLocaleString([], { month: 'short', timeZone: 'UTC' });
  return (
    <Card>
      <CardContent className="flex flex-wrap gap-2 pt-4 text-sm">
        <span className="font-medium">{t('hr.birthdays')}</span>
        {birthdays.data.slice(0, 8).map((b) => (
          <Badge key={b.employeeId}>
            {b.name} · {month(b.month)} {b.day}
          </Badge>
        ))}
      </CardContent>
    </Card>
  );
}
