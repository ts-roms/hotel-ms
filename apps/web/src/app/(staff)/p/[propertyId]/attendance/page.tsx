'use client';

import { addDays, formatDate, localDate } from '@hotel/format';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, X } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { clock, duration, PUNCH_LABEL, today } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { useCan, usePms, usePropertyId } from '@/lib/property';
import { statusLabel, statusVariant } from '@/lib/status';
import { ClockPhotos } from './_components/clock-photos';

/** Daily attendance computed from punches and the published schedule (blueprint §13.2). */
export default function AttendancePage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const can = useCan();
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
  const canDecide = can('attendance.manage');

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
            {can('payroll.export') && (
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
                  <strong>{c.employeeName}</strong> · {t(PUNCH_LABEL[c.type])} ·{' '}
                  {formatDate(localDate(c.at))} {clock(c.at)} ·{' '}
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
              ? 'overflow-hidden opacity-60 transition-opacity'
              : 'animate-fade-in overflow-hidden transition-opacity'
          }
          aria-busy={days.isPlaceholderData}
        >
          <Table className="min-w-180 [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>{t('hr.employee')}</TableHead>
                <TableHead>{t('hr.date')}</TableHead>
                <TableHead>{t('hr.status')}</TableHead>
                <TableHead>{t('hr.shift')}</TableHead>
                <TableHead>{t('hr.in')}</TableHead>
                <TableHead>{t('hr.out')}</TableHead>
                <TableHead>{t('hr.worked')}</TableHead>
                <TableHead>{t('hr.late')}</TableHead>
                <TableHead>{t('hr.undertime')}</TableHead>
                <TableHead>{t('hr.overtime')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {days.data.map((d) => (
                <TableRow key={`${d.employeeId}-${d.date}`}>
                  <TableCell className="font-medium">{d.employeeName}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(d.date)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(d.status)} dot>
                      {statusLabel(d.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {d.shift ? `${clock(d.shift.startsAt)}–${clock(d.shift.endsAt)}` : '—'}
                  </TableCell>
                  <TableCell>{clock(d.firstIn)}</TableCell>
                  <TableCell>{clock(d.lastOut)}</TableCell>
                  <TableCell className="font-medium">{duration(d.workedMinutes)}</TableCell>
                  <TableCell className={d.lateMinutes ? 'text-warning' : undefined}>
                    {duration(d.lateMinutes)}
                  </TableCell>
                  <TableCell className={d.undertimeMinutes ? 'text-warning' : undefined}>
                    {duration(d.undertimeMinutes)}
                  </TableCell>
                  <TableCell className={d.overtimeMinutes ? 'text-info' : undefined}>
                    {duration(d.overtimeMinutes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <ClockPhotos propertyId={propertyId} from={from} to={to} />
    </div>
  );
}
