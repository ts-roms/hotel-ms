'use client';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  LoadingRegion,
  NativeSelect,
  Skeleton,
  SkeletonCard,
  SkeletonText,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Briefcase, Plane } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { today } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel, statusVariant } from '@/lib/status';
import { EmployeeDocuments } from './documents';

export default function EmployeePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const session = useSession();
  const employee = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api.hr.employee(employeeId),
  });
  const e = employee.data;
  if (employee.error) return <Alert>{errorMessage(employee.error)}</Alert>;
  if (!e)
    return (
      <LoadingRegion label={t('loading')} className="flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-4 w-16" />
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-3">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <SkeletonText lines={3} />
        </Card>
        <SkeletonCard lines={2} />
      </LoadingRegion>
    );
  const name = `${e.preferredName || e.firstName} ${e.lastName}`;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link
        href="/hr/employees"
        className="group flex items-center gap-1 self-start text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-1" />
        {t('common.back')}
      </Link>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <Avatar name={name} className="size-12" />
              <div className="flex flex-col gap-1">
                <CardTitle>{name}</CardTitle>
                <CardDescription className="font-mono">{e.employeeNo}</CardDescription>
              </div>
            </div>
            <Badge variant={statusVariant(e.status)} dot>
              {statusLabel(e.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <span>
            {t('hr.hired')}: {formatDate(e.hireDate)}
          </span>
          {e.terminatedOn && (
            <span>
              {t('hr.terminated')}: {formatDate(e.terminatedOn)}
            </span>
          )}
          <span>{e.workEmail ?? '—'}</span>
          <span>{e.workPhone ?? ''}</span>
          <span>{e.membershipId ? t('hr.hasLogin') : t('hr.noLogin')}</span>
          {e.personal ? (
            <span>
              {t('hr.birthDate')}: {e.personal.birthDate ? formatDate(e.personal.birthDate) : '—'}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('hr.personalHidden')}</span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Briefcase className="size-4 text-primary" />
            {t('hr.assignments')}
          </CardTitle>
        </CardHeader>
        <CardContent className="stagger flex flex-col gap-2 text-sm">
          {e.assignmentHistory.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.propertyName}</span>· {a.departmentName}
                {a.positionName && ` · ${a.positionName}`}
                {a.isPrimary && <Badge variant="primary">{t('hr.primary')}</Badge>}
              </span>
              <span className="text-muted-foreground">
                {formatDate(a.startDate)} → {a.endDate ? formatDate(a.endDate) : '…'}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {hasPermission(session.data, 'employee.documents') && <EmployeeDocuments employeeId={e.id} />}
      {hasPermission(session.data, 'leave.read') && <EmployeeLeave employeeId={e.id} />}
    </div>
  );
}

function EmployeeLeave({ employeeId }: { employeeId: string }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const leave = useQuery({
    queryKey: ['employee-leave', employeeId],
    queryFn: () => api.hr.employeeLeave(employeeId),
  });
  const types = useQuery({ queryKey: ['leave-types'], queryFn: api.hr.leaveTypes });
  const [form, setForm] = useState({ leaveTypeId: '', days: '', note: '' });
  // '' means "not chosen yet": show and submit the first type (types load after mount).
  const leaveTypeId = form.leaveTypeId || types.data?.[0]?.id || '';
  const post = useMutation({
    mutationFn: () =>
      api.hr.postLeave(employeeId, {
        leaveTypeId,
        kind: Number(form.days) > 0 ? 'ACCRUAL' : 'ADJUSTMENT',
        days: Number(form.days),
        effectiveDate: today(),
        note: form.note,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['employee-leave', employeeId], data);
      setForm({ ...form, days: '', note: '' });
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    post.mutate();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plane className="size-4 text-primary" />
          {t('hr.leave')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {leave.error && <Alert>{errorMessage(leave.error)}</Alert>}
        <div className="flex flex-wrap gap-2">
          {!leave.data && !leave.error && (
            <>
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </>
          )}
          {leave.data?.balances.map((b) => (
            <Badge key={b.leaveTypeId} variant="primary">
              {b.leaveTypeName}: {b.days} {t('hr.days')}
            </Badge>
          ))}
        </div>
        {hasPermission(session.data, 'leave.manage') && (
          <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2" noValidate>
            <NativeSelect
              className="w-auto"
              aria-label={t('hr.leaveType')}
              value={leaveTypeId}
              onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
            >
              {types.data?.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {lt.name}
                </option>
              ))}
            </NativeSelect>
            <Input
              className="w-24"
              type="number"
              step="0.5"
              placeholder={t('hr.days')}
              aria-label={t('hr.days')}
              value={form.days}
              onChange={(e) => setForm({ ...form, days: e.target.value })}
            />
            <Input
              className="min-w-40 flex-1"
              placeholder={t('hr.note')}
              aria-label={t('hr.note')}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
            <Button
              type="submit"
              variant="outline"
              loading={post.isPending}
              disabled={!leaveTypeId || !Number(form.days) || !form.note.trim()}
            >
              {t('hr.postLeave')}
            </Button>
          </form>
        )}
        {post.error && <Alert>{errorMessage(post.error)}</Alert>}
        {leave.data?.ledger.slice(0, 20).map((l) => (
          <div
            key={l.id}
            className="flex justify-between gap-2 border-t pt-2 text-muted-foreground"
          >
            <span>
              {formatDate(l.effectiveDate)} · {l.leaveTypeCode} · {l.kind.toLowerCase()} · {l.note}
            </span>
            <span
              className={
                l.days > 0 ? 'font-medium tabular-nums text-success' : 'font-medium tabular-nums'
              }
            >
              {l.days > 0 ? '+' : ''}
              {l.days}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
