'use client';

import {
  buttonVariants,
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  LoadingRegion,
  PageHeader,
  SkeletonTable,
} from '@hotel/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, X } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDate } from '@/lib/format';
import { clock, duration, today } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel, statusVariant } from '@/lib/status';
import { ClockPhotos } from './clock-photos';

/** Daily attendance computed from punches and the published schedule (blueprint §13.2). */
export default function AttendancePage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const queryClient = useQueryClient();
  const [to, setTo] = useState(today);
  const from = addDays(to, -6);
  const days = useQuery({
    queryKey: ['attendance', propertyId, to],
    queryFn: () => pms.attendance(from, to),
    // Keep the table on screen while another week loads.
    placeholderData: keepPreviousData,
  });
  const corrections = useQuery({
    queryKey: ['corrections', propertyId],
    queryFn: () => pms.attendanceCorrections('PENDING'),
  });
  const decide = useMutation({
    mutationFn: (input: { id: string; version: number; decision: 'APPROVE' | 'REJECT' }) =>
      pms.decideCorrection(input.id, input.version, { decision: input.decision, note: '' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['corrections', propertyId] }),
  });
  const running = (id: string, decision: 'APPROVE' | 'REJECT') =>
    decide.isPending && decide.variables?.id === id && decide.variables.decision === decision;
  const canDecide = hasPermission(session.data, 'attendance.manage');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('hr.attendance')}
        description={
          <>
            {formatDate(from)} – {formatDate(to)}
          </>
        }
        actions={
          <>
            <Input
              type="date"
              className="h-9 w-auto"
              aria-label={t('hr.to')}
              value={to}
              onChange={(e) => e.target.value && setTo(e.target.value)}
            />
            {hasPermission(session.data, 'payroll.export') && (
              <a
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                href={pms.payrollExportUrl(from, to)}
                download
              >
                {t('hr.payrollCsv')}
              </a>
            )}
          </>
        }
      />
      {(days.error || decide.error) && <Alert>{errorMessage(days.error ?? decide.error)}</Alert>}

      {!!corrections.data?.length && (
        <Card className="animate-fade-in border-warning/40">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              {t('hr.pendingCorrections')}
              <Badge variant="warning">{corrections.data.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="stagger flex flex-col gap-2 text-sm">
            {corrections.data.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <span>
                  <strong>{c.employeeName}</strong> · {statusLabel(c.type).toLowerCase()} ·{' '}
                  {formatDate(new Date(c.at).toLocaleDateString('en-CA'))} {clock(c.at)} ·{' '}
                  <span className="text-muted-foreground">{c.reason}</span>
                </span>
                {canDecide && (
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      loading={running(c.id, 'APPROVE')}
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: c.id, version: c.version, decision: 'APPROVE' })
                      }
                    >
                      {!running(c.id, 'APPROVE') && <Check />}
                      {t('hr.approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="hover:text-destructive"
                      loading={running(c.id, 'REJECT')}
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: c.id, version: c.version, decision: 'REJECT' })
                      }
                    >
                      {!running(c.id, 'REJECT') && <X />}
                      {t('hr.reject')}
                    </Button>
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {days.isPending && (
        <Card className="p-4">
          <LoadingRegion label={t('loading')}>
            <SkeletonTable rows={6} columns={8} />
          </LoadingRegion>
        </Card>
      )}
      {days.data?.length === 0 && <EmptyState icon={<Clock />} title={t('hr.noAttendance')} />}
      {!!days.data?.length && (
        <Card
          className={
            days.isPlaceholderData
              ? 'overflow-x-auto opacity-60 transition-opacity'
              : 'animate-fade-in overflow-x-auto transition-opacity'
          }
          aria-busy={days.isPlaceholderData}
        >
          <table className="w-full min-w-180 text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b bg-muted/40">
                <th className="px-3 py-3 font-semibold">{t('hr.employee')}</th>
                <th className="px-3 py-3 font-semibold">{t('hr.date')}</th>
                <th className="px-3 py-3 font-semibold">{t('hr.status')}</th>
                <th className="px-3 py-3 font-semibold">{t('hr.shift')}</th>
                <th className="px-3 py-3 font-semibold">{t('hr.in')}</th>
                <th className="px-3 py-3 font-semibold">{t('hr.out')}</th>
                <th className="px-3 py-3 font-semibold">{t('hr.worked')}</th>
                <th className="px-3 py-3 font-semibold">{t('hr.late')}</th>
                <th className="px-3 py-3 font-semibold">{t('hr.undertime')}</th>
                <th className="px-3 py-3 font-semibold">{t('hr.overtime')}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {days.data.map((d) => (
                <tr
                  key={`${d.employeeId}-${d.date}`}
                  className="border-t transition-colors hover:bg-accent/40"
                >
                  <td className="px-3 py-2.5 font-medium">{d.employeeName}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{formatDate(d.date)}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={statusVariant(d.status)} dot>
                      {statusLabel(d.status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    {d.shift ? `${clock(d.shift.startsAt)}–${clock(d.shift.endsAt)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5">{clock(d.firstIn)}</td>
                  <td className="px-3 py-2.5">{clock(d.lastOut)}</td>
                  <td className="px-3 py-2.5 font-medium">{duration(d.workedMinutes)}</td>
                  <td className={d.lateMinutes ? 'px-3 py-2.5 text-warning' : 'px-3 py-2.5'}>
                    {duration(d.lateMinutes)}
                  </td>
                  <td className={d.undertimeMinutes ? 'px-3 py-2.5 text-warning' : 'px-3 py-2.5'}>
                    {duration(d.undertimeMinutes)}
                  </td>
                  <td className={d.overtimeMinutes ? 'px-3 py-2.5 text-info' : 'px-3 py-2.5'}>
                    {duration(d.overtimeMinutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <ClockPhotos propertyId={propertyId} from={from} to={to} />
    </div>
  );
}
