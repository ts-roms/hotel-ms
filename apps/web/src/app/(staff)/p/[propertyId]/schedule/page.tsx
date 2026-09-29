'use client';

import type { ShiftWarning } from '@hotel/contracts';
import { addDays, formatDate } from '@hotel/format';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  cn,
  EmptyState,
  Input,
  LoadingRegion,
  Notice,
  PageHeader,
  NativeSelect,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Cake,
  ChevronLeft,
  ChevronRight,
  Plus,
  Repeat,
  Send,
  TriangleAlert,
  X,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { mondayOf, today, weekDays } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { usePms, usePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';
import { CoverageGaps, RecurringShifts, StaffingRequirements } from './staffing';

/** Weekly staff schedule (blueprint §13.3): plan in drafts, then publish. */
export default function SchedulePage() {
  const propertyId = usePropertyId();
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
    // Keep the grid on screen while another week loads.
    placeholderData: keepPreviousData,
  });
  const coverage = useQuery({
    queryKey: ['coverage', propertyId, monday],
    queryFn: () => pms.coverage(monday, sunday),
    placeholderData: keepPreviousData,
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['schedule', propertyId] }),
      queryClient.invalidateQueries({ queryKey: ['coverage', propertyId] }),
    ]);
  const publish = useMutation({
    mutationFn: () => pms.publishSchedule(monday, sunday),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: (s: { id: string; version: number }) => pms.cancelShift(s.id, s.version),
    onSettled: refresh,
  });
  const cancelSeries = useMutation({
    mutationFn: (s: { seriesId: string; date: string; employeeId: string }) =>
      pms.cancelShiftSeries(s.seriesId, { fromDate: s.date, employeeId: s.employeeId }),
    onSettled: refresh,
  });
  const gaps = coverage.data ?? [];
  const gapDays = new Set(gaps.map((g) => g.date));

  const data = schedule.data;
  const paging = schedule.isPlaceholderData;
  const drafts = data?.shifts.filter((s) => s.status === 'DRAFT').length ?? 0;
  const todayDate = today();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('hr.schedule')}
        description={
          <>
            {formatDate(monday)} – {formatDate(sunday)}
          </>
        }
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                className="size-9"
                aria-label={t('hr.prevWeek')}
                disabled={paging}
                onClick={() => setMonday(addDays(monday, -7))}
              >
                <ChevronLeft />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="size-9"
                aria-label={t('hr.nextWeek')}
                disabled={paging}
                onClick={() => setMonday(addDays(monday, 7))}
              >
                <ChevronRight />
              </Button>
            </div>
            {canManage && (
              <Button
                size="sm"
                className="h-9"
                loading={publish.isPending}
                disabled={drafts === 0 || paging}
                onClick={() => publish.mutate()}
              >
                {!publish.isPending && <Send />}
                {t('hr.publish')}
                <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[11px] tabular-nums">
                  {drafts}
                </span>
              </Button>
            )}
          </>
        }
      />
      {publish.isSuccess && (
        <Notice>
          {publish.data.published} {t('hr.published')}
          {publish.data.gaps.length > 0 && ` · ${publish.data.gaps.length} ${t('sched.gapsLeft')}`}
        </Notice>
      )}
      {cancelSeries.isSuccess && (
        <Notice>
          {cancelSeries.data.cancelled} {t('sched.seriesCancelled')}
        </Notice>
      )}
      {(schedule.error || publish.error || cancel.error || cancelSeries.error) && (
        <Alert>
          {errorMessage(schedule.error ?? publish.error ?? cancel.error ?? cancelSeries.error)}
        </Alert>
      )}
      <CoverageGaps gaps={gaps} />

      {canManage && data && <NewShift employees={data.employees} days={days} onCreated={refresh} />}
      {canManage && data && (
        <RecurringShifts employees={data.employees} from={monday} onCreated={refresh} />
      )}

      {schedule.isPending && (
        <Card className="p-4">
          <LoadingRegion label={t('loading')}>
            <SkeletonTable rows={5} columns={8} />
          </LoadingRegion>
        </Card>
      )}
      {data?.employees.length === 0 && (
        <EmptyState icon={<CalendarClock />} title={t('hr.noStaff')} />
      )}
      {!!data?.employees.length && (
        <Card
          className={cn(
            'animate-fade-in overflow-hidden transition-opacity duration-300',
            paging && 'opacity-50',
          )}
          aria-busy={paging}
        >
          <Table className="min-w-205 border-collapse">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="sticky left-0 z-10 bg-card">{t('hr.employee')}</TableHead>
                {days.map((d) => (
                  <TableHead
                    key={d}
                    className={cn(
                      'px-2 font-medium normal-case tracking-normal',
                      d === todayDate && 'text-primary',
                    )}
                  >
                    <span className="flex items-center gap-1">
                      {formatDate(d)}
                      {gapDays.has(d) && (
                        <TriangleAlert
                          className="size-3.5 text-warning"
                          aria-label={t('sched.understaffed')}
                        />
                      )}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.employees.map((e) => (
                <TableRow key={e.id} className="align-top hover:bg-accent/20">
                  <TableCell className="sticky left-0 z-10 bg-card py-3 align-top">
                    <div className="flex items-center gap-2">
                      <Avatar name={e.name} className="size-8 text-xs" />
                      <div className="flex flex-col">
                        <span className="font-medium">{e.name}</span>
                        <span className="text-xs text-muted-foreground">{e.departmentName}</span>
                      </div>
                    </div>
                  </TableCell>
                  {days.map((d) => {
                    const shifts = data.shifts.filter((s) => s.employeeId === e.id && s.date === d);
                    const away = data.unavailability.find(
                      (u) => u.employeeId === e.id && u.from <= d && u.to >= d,
                    );
                    return (
                      <TableCell
                        key={d}
                        className={cn('px-1.5 py-2 align-top', d === todayDate && 'bg-primary/3')}
                      >
                        {away && (
                          <Badge variant="info" className="mb-1">
                            {away.label}
                          </Badge>
                        )}
                        {shifts.map((s) => (
                          <div
                            key={s.id}
                            className={cn(
                              'group mb-1 flex animate-scale-in items-start justify-between gap-1 rounded-lg border px-2 py-1.5 text-xs transition-colors',
                              s.status === 'DRAFT'
                                ? 'border-dashed bg-card'
                                : 'border-primary/30 bg-primary/10 text-primary',
                            )}
                          >
                            <div className="flex flex-col">
                              <span className="whitespace-nowrap font-medium tabular-nums">
                                {s.startTime}–{s.endTime}
                              </span>
                              {s.status === 'DRAFT' && (
                                <span className="text-muted-foreground">{t('hr.draft')}</span>
                              )}
                            </div>
                            {canManage && s.seriesId && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t('sched.cancelSeries')}
                                    title={t('sched.cancelSeries')}
                                    disabled={cancelSeries.isPending}
                                    className="size-4 rounded p-0.5 opacity-60 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 [&_svg]:size-3"
                                  >
                                    <Repeat />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      {t('sched.cancelSeriesConfirm')}
                                    </AlertDialogTitle>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>{t('sched.keepShifts')}</AlertDialogCancel>
                                    <AlertDialogAction
                                      variant="destructive"
                                      onClick={() =>
                                        cancelSeries.mutate({
                                          seriesId: s.seriesId!,
                                          date: s.date,
                                          employeeId: s.employeeId,
                                        })
                                      }
                                    >
                                      {t('sched.cancelShifts')}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                            {canManage && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={t('hr.cancel')}
                                title={t('hr.cancel')}
                                disabled={cancel.isPending}
                                className="size-4 rounded p-0.5 opacity-60 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 [&_svg]:size-3"
                                onClick={() => cancel.mutate(s)}
                              >
                                <X />
                              </Button>
                            )}
                          </div>
                        ))}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <StaffingRequirements canManage={canManage} />
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
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const templates = useQuery({
    queryKey: ['shift-templates', propertyId],
    queryFn: pms.shiftTemplates,
  });
  const [form, setForm] = useState({ employeeId: '', date: days[0]!, templateId: '' });
  const [warnings, setWarnings] = useState<ShiftWarning[]>([]);
  // '' means "not chosen yet": show and submit the first option. The templates load after
  // the first render, so the select must be given that option explicitly or it shows blank.
  const employeeId = form.employeeId || employees[0]?.id || '';
  const templateId = form.templateId || templates.data?.[0]?.id || '';
  const create = useMutation({
    mutationFn: () =>
      pms.createShift({
        employeeId,
        date: form.date,
        templateId,
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
    <Card className="animate-fade-in">
      <CardContent className="flex flex-col gap-2 pt-5">
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2" noValidate>
          <NativeSelect
            className="w-auto"
            aria-label={t('hr.employee')}
            value={employeeId}
            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </NativeSelect>
          <Input
            type="date"
            className="w-auto"
            aria-label={t('hr.date')}
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
          <NativeSelect
            className="w-auto"
            aria-label={t('hr.shiftTemplate')}
            value={templateId}
            onChange={(e) => setForm({ ...form, templateId: e.target.value })}
          >
            {templates.data?.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} {tpl.startTime}–{tpl.endTime}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" loading={create.isPending} disabled={!employeeId || !templateId}>
            {!create.isPending && <Plus />}
            {t('hr.addShift')}
          </Button>
        </form>
        {create.error && <Alert>{errorMessage(create.error)}</Alert>}
        {warnings.map((w) => (
          <Notice key={w.code} className="border-warning/30 bg-warning/10">
            {w.message}
          </Notice>
        ))}
      </CardContent>
    </Card>
  );
}

function Birthdays() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const birthdays = useQuery({ queryKey: ['birthdays', propertyId], queryFn: pms.birthdays });
  if (!birthdays.data?.length) return null;
  const month = (m: number) =>
    new Date(Date.UTC(2000, m - 1, 1)).toLocaleString([], { month: 'short', timeZone: 'UTC' });
  return (
    <Card className="animate-fade-in">
      <CardContent className="flex flex-wrap items-center gap-2 pt-5 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Cake className="size-4 text-primary" />
          {t('hr.birthdays')}
        </span>
        {birthdays.data.slice(0, 8).map((b) => (
          <Badge key={b.employeeId} variant="primary">
            {b.name} · {month(b.month)} {b.day}
          </Badge>
        ))}
      </CardContent>
    </Card>
  );
}
