'use client';

import type { LeaveDecisionResult, LeaveRequest } from '@hotel/contracts';
import { formatDate } from '@hotel/format';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  LoadingRegion,
  Notice,
  PageHeader,
  NativeSelect,
  SkeletonRow,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plane, X } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useCan, usePms, usePropertyId } from '@/lib/property';
import { statusLabel, statusVariant } from '@/lib/status';

/** Leave requests routed to this property (blueprint §13.4). */
export default function LeavePage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const can = useCan();
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
  const running = (r: LeaveRequest, decision: 'APPROVE' | 'REJECT') =>
    decide.isPending &&
    decide.variables?.request.id === r.id &&
    decide.variables.decision === decision;
  const canApprove = can('leave.approve');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('hr.leave')}
        actions={
          <NativeSelect
            className="h-9 w-auto"
            aria-label={t('hr.status')}
            value={status}
            onChange={(e) => setStatus(e.target.value as LeaveRequest['status'])}
          >
            {(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </NativeSelect>
        }
      />
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
      {requests.isPending && (
        <LoadingRegion label={t('loading')} className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </LoadingRegion>
      )}
      {requests.data?.length === 0 && <EmptyState icon={<Plane />} title={t('hr.noLeave')} />}
      <div className="stagger flex flex-col gap-3">
        {requests.data?.map((r) => (
          <Card key={r.id}>
            <CardContent className="flex flex-col gap-3 pt-5 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <Avatar name={r.employeeName} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{r.employeeName}</span>
                  <span className="text-muted-foreground">
                    {r.leaveTypeName} · {formatDate(r.startDate)} → {formatDate(r.endDate)}
                  </span>
                </div>
                <Badge variant="primary" className="tabular-nums">
                  {r.days} {t('hr.days')}
                </Badge>
                <Badge variant={statusVariant(r.status)} dot>
                  {statusLabel(r.status)}
                </Badge>
                {r.status === 'PENDING' && r.approvalsRequired === 2 && (
                  <Badge variant="outline">
                    {r.approvalStep === 1 ? t('hr.awaitingManager') : t('hr.awaitingHr')}
                  </Badge>
                )}
              </div>
              {r.approvals.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {r.approvals.map((a) => (
                    <li key={a.step}>
                      {a.decision === 'APPROVE' ? t('hr.approvedBy') : t('hr.rejectedBy')}{' '}
                      {a.decidedBy}
                      {a.note && ` · ${a.note}`}
                    </li>
                  ))}
                </ul>
              )}
              {r.reason && (
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-muted-foreground">{r.reason}</p>
              )}
              {r.decisionNote && <p className="text-muted-foreground">{r.decisionNote}</p>}
              {canApprove && r.status === 'PENDING' && (
                <div className="flex flex-wrap gap-2">
                  <Input
                    className="h-9 min-w-48 flex-1"
                    placeholder={t('hr.note')}
                    aria-label={t('hr.note')}
                    value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                  />
                  <Button
                    size="sm"
                    className="h-9"
                    loading={running(r, 'APPROVE')}
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ request: r, decision: 'APPROVE' })}
                  >
                    {!running(r, 'APPROVE') && <Check />}
                    {t('hr.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 hover:text-destructive"
                    loading={running(r, 'REJECT')}
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ request: r, decision: 'REJECT' })}
                  >
                    {!running(r, 'REJECT') && <X />}
                    {t('hr.reject')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
