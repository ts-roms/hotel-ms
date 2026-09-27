'use client';

import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDate } from '@/lib/format';
import { clock, duration, today } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

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
  const canDecide = hasPermission(session.data, 'attendance.manage');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('hr.attendance')}</h1>
        <Input
          type="date"
          className="w-auto"
          aria-label={t('hr.to')}
          value={to}
          onChange={(e) => e.target.value && setTo(e.target.value)}
        />
      </div>
      {(days.error || decide.error) && <Alert>{errorMessage(days.error ?? decide.error)}</Alert>}

      {!!corrections.data?.length && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('hr.pendingCorrections')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {corrections.data.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
              >
                <span>
                  <strong>{c.employeeName}</strong> · {c.type.toLowerCase().replace('_', ' ')} ·{' '}
                  {formatDate(c.at.slice(0, 10))} {clock(c.at)} · {c.reason}
                </span>
                {canDecide && (
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: c.id, version: c.version, decision: 'APPROVE' })
                      }
                    >
                      {t('hr.approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: c.id, version: c.version, decision: 'REJECT' })
                      }
                    >
                      {t('hr.reject')}
                    </Button>
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-2">{t('hr.employee')}</th>
              <th>{t('hr.date')}</th>
              <th>{t('hr.status')}</th>
              <th>{t('hr.shift')}</th>
              <th>{t('hr.in')}</th>
              <th>{t('hr.out')}</th>
              <th>{t('hr.worked')}</th>
              <th>{t('hr.late')}</th>
              <th>{t('hr.undertime')}</th>
              <th>{t('hr.overtime')}</th>
            </tr>
          </thead>
          <tbody>
            {days.data?.map((d) => (
              <tr key={`${d.employeeId}-${d.date}`} className="border-t">
                <td className="py-1.5">{d.employeeName}</td>
                <td>{formatDate(d.date)}</td>
                <td>
                  <Badge>{d.status.toLowerCase().replace('_', ' ')}</Badge>
                </td>
                <td className="tabular-nums">
                  {d.shift ? `${clock(d.shift.startsAt)}–${clock(d.shift.endsAt)}` : '—'}
                </td>
                <td>{clock(d.firstIn)}</td>
                <td>{clock(d.lastOut)}</td>
                <td>{duration(d.workedMinutes)}</td>
                <td>{duration(d.lateMinutes)}</td>
                <td>{duration(d.undertimeMinutes)}</td>
                <td>{duration(d.overtimeMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {days.data?.length === 0 && <p className="text-muted-foreground">{t('hr.noAttendance')}</p>}
      </div>
    </div>
  );
}
