'use client';

import { addDays, formatDate } from '@hotel/format';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  LoadingRegion,
  Notice,
  PageHeader,
  SkeletonTable,
} from '@hotel/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { mondayOf, today, weekDays } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { useCan, usePms, usePropertyId } from '@/lib/property';
import { Birthdays } from './_components/birthdays';
import { CoverageGaps } from './_components/coverage-gaps';
import { NewShift } from './_components/new-shift-form';
import { RecurringShifts } from './_components/recurring-shifts';
import { ScheduleGrid } from './_components/schedule-grid';
import { StaffingRequirements } from './_components/staffing-requirements';

/** Weekly staff schedule (blueprint §13.3): plan in drafts, then publish. */
export default function SchedulePage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const can = useCan();
  const queryClient = useQueryClient();
  const [monday, setMonday] = useState(() => mondayOf(today()));
  const days = weekDays(monday);
  const sunday = days[6]!;
  const canManage = can('schedule.manage');

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
          {t('hr.publishedCount', { count: publish.data.published })}
          {publish.data.gaps.length > 0 &&
            ` · ${t('sched.gapsLeftCount', { count: publish.data.gaps.length })}`}
        </Notice>
      )}
      {cancelSeries.isSuccess && (
        <Notice>{t('sched.seriesCancelledCount', { count: cancelSeries.data.cancelled })}</Notice>
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
        <ScheduleGrid
          data={data}
          days={days}
          todayDate={todayDate}
          gapDays={gapDays}
          paging={paging}
          canManage={canManage}
          cancelPending={cancel.isPending}
          onCancel={(s) => cancel.mutate(s)}
          cancelSeriesPending={cancelSeries.isPending}
          onCancelSeries={(s) => cancelSeries.mutate(s)}
        />
      )}

      <StaffingRequirements canManage={canManage} />
      {can('birthday.read') && <Birthdays />}
    </div>
  );
}
