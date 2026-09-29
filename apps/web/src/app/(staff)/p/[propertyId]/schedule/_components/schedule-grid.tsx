'use client';

import type { Schedule, Shift } from '@hotel/contracts';
import { formatDate } from '@hotel/format';
import {
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
  cn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { Repeat, TriangleAlert, X } from 'lucide-react';
import { t } from '@/lib/i18n';

/** The week grid: one row per employee, their shifts and absences per day. */
export function ScheduleGrid({
  data,
  days,
  todayDate,
  gapDays,
  paging,
  canManage,
  cancelPending,
  onCancel,
  cancelSeriesPending,
  onCancelSeries,
}: {
  data: Schedule;
  days: string[];
  todayDate: string;
  gapDays: Set<string>;
  paging: boolean;
  canManage: boolean;
  cancelPending: boolean;
  onCancel: (shift: Shift) => void;
  cancelSeriesPending: boolean;
  onCancelSeries: (s: { seriesId: string; date: string; employeeId: string }) => void;
}) {
  return (
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
                                disabled={cancelSeriesPending}
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
                                    onCancelSeries({
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
                            disabled={cancelPending}
                            className="size-4 rounded p-0.5 opacity-60 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 [&_svg]:size-3"
                            onClick={() => onCancel(s)}
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
  );
}
