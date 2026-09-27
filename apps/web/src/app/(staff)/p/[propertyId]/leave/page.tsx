'use client';

import type { LeaveDecisionResult, LeaveRequest } from '@hotel/contracts';
import { Alert, Badge, Button, Card, CardContent, Input, Notice, Select } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

/** Leave requests routed to this property (blueprint §13.4). */
export default function LeavePage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LeaveRequest['status']>('PENDING');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [result, setResult] = useState<LeaveDecisionResult | null>(null);
  const requests = useQuery({
    queryKey: ['leave-requests', propertyId, status],
    queryFn: () => pms.leaveRequests(status),
  });
  const decide = useMutation({
    mutationFn: (input: { request: LeaveRequest; decision: 'APPROVE' | 'REJECT' }) =>
      pms.decideLeave(input.request.id, input.request.version, {
        decision: input.decision,
        note: notes[input.request.id] ?? '',
      }),
    onSuccess: setResult,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['leave-requests', propertyId] }),
  });
  const canApprove = hasPermission(session.data, 'leave.approve');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('hr.leave')}</h1>
        <Select
          className="w-auto"
          aria-label={t('hr.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as LeaveRequest['status'])}
        >
          {(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </Select>
      </div>
      {(requests.error || decide.error) && (
        <Alert>{errorMessage(requests.error ?? decide.error)}</Alert>
      )}
      {result && result.conflictingShifts.length > 0 && (
        <Notice>
          {t('hr.leaveConflicts')}{' '}
          {result.conflictingShifts
            .map((s) => `${formatDate(s.date)} ${s.startTime}–${s.endTime}`)
            .join(', ')}
        </Notice>
      )}
      {requests.data?.length === 0 && <p className="text-muted-foreground">{t('hr.noLeave')}</p>}
      {requests.data?.map((r) => (
        <Card key={r.id}>
          <CardContent className="flex flex-col gap-2 pt-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>{r.employeeName}</strong> · {r.leaveTypeName} · {formatDate(r.startDate)} →{' '}
                {formatDate(r.endDate)} ({r.days} {t('hr.days')})
              </span>
              <Badge>{r.status.toLowerCase()}</Badge>
            </div>
            {r.reason && <p className="text-muted-foreground">{r.reason}</p>}
            {r.decisionNote && <p className="text-muted-foreground">{r.decisionNote}</p>}
            {canApprove && r.status === 'PENDING' && (
              <div className="flex flex-wrap gap-2">
                <Input
                  className="min-w-48 flex-1"
                  placeholder={t('hr.note')}
                  aria-label={t('hr.note')}
                  value={notes[r.id] ?? ''}
                  onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                />
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ request: r, decision: 'APPROVE' })}
                >
                  {t('hr.approve')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ request: r, decision: 'REJECT' })}
                >
                  {t('hr.reject')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
