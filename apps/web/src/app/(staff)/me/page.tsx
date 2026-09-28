'use client';

import type { PunchType } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  LoadingRegion,
  Notice,
  PageHeader,
  Select,
  SkeletonCard,
  SkeletonTable,
  Skeleton,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Camera, Clock as ClockIcon, Plane, Timer } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { SelfiePreview, useSelfieCamera } from '@/components/selfie-camera';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDate } from '@/lib/format';
import { clock, duration, mondayOf, PUNCH_NEXT, today } from '@/lib/hr';
import { type MessageKey, t } from '@/lib/i18n';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel, statusVariant } from '@/lib/status';

const PUNCH_LABEL: Record<PunchType, MessageKey> = {
  IN: 'hr.clockIn',
  OUT: 'hr.clockOut',
  BREAK_START: 'hr.breakStart',
  BREAK_END: 'hr.breakEnd',
};

/** Self service: clock, own shifts and attendance, leave, corrections (blueprint §13). */
export default function MyTimePage() {
  const me = useQuery({ queryKey: ['me', 'employee'], queryFn: api.me.employee });
  const session = useSession();

  if (me.isPending)
    return (
      <LoadingRegion label={t('loading')} className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={4} />
      </LoadingRegion>
    );
  if (me.error) return <Alert>{errorMessage(me.error)}</Alert>;
  if (!me.data.employee) return <Notice>{t('hr.notEmployee')}</Notice>;

  const employee = me.data.employee;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('hr.myTime')}
        description={`${employee.preferredName || employee.firstName} ${employee.lastName}`}
      />
      <div className="stagger flex flex-col gap-4">
        {hasPermission(session.data, 'attendance.punch.own') && <Clock />}
        {hasPermission(session.data, 'schedule.read.own') && <MyShifts />}
        {hasPermission(session.data, 'attendance.punch.own') && <MyAttendance />}
        {hasPermission(session.data, 'leave.request.own') && <MyLeave />}
      </div>
    </div>
  );
}

function Clock() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me', 'employee'], queryFn: api.me.employee });
  // A punch needs a selfie taken now (ADR-0022): the button opens the camera first.
  const [pending, setPending] = useState<{ propertyId: string; type: PunchType } | null>(null);
  const punch = useMutation({
    mutationFn: (input: { propertyId: string; type: PunchType; selfie: Blob }) =>
      api.pms(input.propertyId).punch(input.type, input.selfie),
    onSuccess: () => {
      setPending(null);
      return queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const employee = me.data?.employee;
  if (!employee) return null;
  const last = me.data?.lastPunch;
  const state = last?.type ?? 'NONE';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Timer className="size-4 text-primary" />
          {t('hr.clock')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {punch.error && <Alert>{errorMessage(punch.error)}</Alert>}
        <p className="flex items-center gap-2 text-muted-foreground">
          <span
            aria-hidden="true"
            className={
              state === 'IN' || state === 'BREAK_END'
                ? 'size-2 animate-pulse rounded-full bg-success'
                : 'size-2 rounded-full bg-muted-foreground/40'
            }
          />
          {last
            ? `${t(PUNCH_LABEL[last.type])} · ${formatDate(new Date(last.at).toLocaleDateString('en-CA'))} ${clock(last.at)}`
            : t('hr.noPunches')}
        </p>
        {employee.assignments.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
            <span className="min-w-40 font-medium">{a.propertyName}</span>
            {PUNCH_NEXT[state]!.map((type) => (
              <Button
                key={type}
                size="sm"
                variant={type === 'IN' || type === 'OUT' ? 'default' : 'outline'}
                disabled={punch.isPending || pending !== null}
                onClick={() => {
                  punch.reset();
                  setPending({ propertyId: a.propertyId, type });
                }}
              >
                {t(PUNCH_LABEL[type])}
              </Button>
            ))}
          </div>
        ))}
        {pending && (
          <SelfiePunch
            label={t(PUNCH_LABEL[pending.type])}
            retentionDays={me.data?.photoRetentionDays ?? 90}
            busy={punch.isPending}
            onCapture={(selfie) => punch.mutate({ ...pending, selfie })}
            onCancel={() => setPending(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Camera panel for one punch; the stream stops when it closes. */
function SelfiePunch({
  label,
  retentionDays,
  busy,
  onCapture,
  onCancel,
}: {
  label: string;
  retentionDays: number;
  busy: boolean;
  onCapture: (selfie: Blob) => void;
  onCancel: () => void;
}) {
  const camera = useSelfieCamera();
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <SelfiePreview camera={camera} className="max-w-sm" />
      {camera.error && <Alert>{camera.error}</Alert>}
      <p className="text-xs text-muted-foreground">
        {t('clock.photoNotice')} {retentionDays} {t('clock.days')}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          loading={busy}
          disabled={!camera.ready}
          onClick={() => void camera.capture().then(onCapture)}
        >
          <Camera className="size-4" />
          {t('clock.takePhoto')} · {label}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t('fin.cancel')}
        </Button>
      </div>
    </div>
  );
}

function MyShifts() {
  const monday = mondayOf(today());
  const shifts = useQuery({
    queryKey: ['me', 'shifts', monday],
    queryFn: () => api.me.shifts(monday, addDays(monday, 13)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-primary" />
          {t('hr.myShifts')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        {shifts.isPending && <SkeletonTable rows={3} columns={3} />}
        {shifts.data?.length === 0 && (
          <p className="rounded-lg border border-dashed py-6 text-center text-muted-foreground">
            {t('hr.noShifts')}
          </p>
        )}
        {shifts.data?.map((s) => (
          <div
            key={s.id}
            className={
              s.date === today()
                ? 'flex justify-between gap-2 rounded-lg bg-primary/10 px-3 py-2 text-primary'
                : 'flex justify-between gap-2 border-b px-3 py-2 last:border-0'
            }
          >
            <span className="font-medium">{formatDate(s.date)}</span>
            <span className="tabular-nums">
              {s.startTime}–{s.endTime}
            </span>
            <span className="text-muted-foreground">{s.departmentName}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MyAttendance() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me', 'employee'], queryFn: api.me.employee });
  const to = today();
  const from = addDays(to, -6);
  const days = useQuery({
    queryKey: ['me', 'attendance', from],
    queryFn: () => api.me.attendance(from, to),
  });
  const corrections = useQuery({ queryKey: ['me', 'corrections'], queryFn: api.me.corrections });
  const [form, setForm] = useState({ type: 'OUT' as PunchType, at: '', reason: '' });
  const propertyId = me.data?.employee?.assignments[0]?.propertyId ?? '';
  const request = useMutation({
    mutationFn: () =>
      api.me.requestCorrection({
        propertyId,
        type: form.type,
        at: new Date(form.at).toISOString(),
        reason: form.reason,
      }),
    onSuccess: () => {
      setForm({ type: 'OUT', at: '', reason: '' });
      return queryClient.invalidateQueries({ queryKey: ['me', 'corrections'] });
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    request.mutate();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClockIcon className="size-4 text-primary" />
          {t('hr.myAttendance')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {days.isPending && <SkeletonTable rows={4} columns={6} />}
        <div className="overflow-x-auto">
          <table className="w-full text-left [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b">
                <th className="py-2">{t('hr.date')}</th>
                <th>{t('hr.status')}</th>
                <th>{t('hr.in')}</th>
                <th>{t('hr.out')}</th>
                <th>{t('hr.worked')}</th>
                <th>{t('hr.late')}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {days.data?.map((d) => (
                <tr
                  key={`${d.date}-${d.shift?.startsAt ?? ''}`}
                  className="border-t transition-colors hover:bg-accent/40"
                >
                  <td className="py-2">{formatDate(d.date)}</td>
                  <td>
                    <Badge variant={statusVariant(d.status)} dot>
                      {statusLabel(d.status)}
                    </Badge>
                  </td>
                  <td>{clock(d.firstIn)}</td>
                  <td>{clock(d.lastOut)}</td>
                  <td>{duration(d.workedMinutes)}</td>
                  <td>{duration(d.lateMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          onSubmit={onSubmit}
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/40 p-3"
          noValidate
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="corr-type">{t('hr.missedPunch')}</Label>
            <Select
              id="corr-type"
              className="w-auto"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as PunchType })}
            >
              {(Object.keys(PUNCH_LABEL) as PunchType[]).map((type) => (
                <option key={type} value={type}>
                  {t(PUNCH_LABEL[type])}
                </option>
              ))}
            </Select>
          </div>
          <Input
            type="datetime-local"
            aria-label={t('hr.when')}
            className="w-auto"
            value={form.at}
            onChange={(e) => setForm({ ...form, at: e.target.value })}
          />
          <Input
            className="min-w-48 flex-1"
            placeholder={t('hr.reason')}
            aria-label={t('hr.reason')}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
          <Button
            type="submit"
            variant="outline"
            loading={request.isPending}
            disabled={!form.at || form.reason.trim().length < 3 || !propertyId}
          >
            {t('hr.requestCorrection')}
          </Button>
        </form>
        {request.error && <Alert>{errorMessage(request.error)}</Alert>}
        {corrections.data?.slice(0, 5).map((c) => (
          <div key={c.id} className="flex justify-between gap-2 text-muted-foreground">
            <span>
              {t(PUNCH_LABEL[c.type])} · {formatDate(new Date(c.at).toLocaleDateString('en-CA'))}{' '}
              {clock(c.at)}
            </span>
            <Badge variant={statusVariant(c.status)} dot>
              {statusLabel(c.status)}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MyLeave() {
  const queryClient = useQueryClient();
  const leave = useQuery({ queryKey: ['me', 'leave'], queryFn: api.me.leave });
  const types = useQuery({ queryKey: ['leave-types'], queryFn: api.hr.leaveTypes });
  const [form, setForm] = useState({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
  // '' means "not chosen yet": show and submit the first active type (types load after mount).
  const activeTypes = types.data?.filter((lt) => !lt.archived) ?? [];
  const leaveTypeId = form.leaveTypeId || activeTypes[0]?.id || '';
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me', 'leave'] });
  const request = useMutation({
    mutationFn: () => api.me.requestLeave({ ...form, leaveTypeId }),
    onSuccess: () => {
      setForm({ leaveTypeId: form.leaveTypeId, startDate: '', endDate: '', reason: '' });
      return refresh();
    },
  });
  const cancel = useMutation({ mutationFn: api.me.cancelLeave, onSuccess: refresh });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    request.mutate();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plane className="size-4 text-primary" />
          {t('hr.myLeave')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap gap-2">
          {leave.isPending && (
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
        <form
          onSubmit={onSubmit}
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/40 p-3"
          noValidate
        >
          <Select
            aria-label={t('hr.leaveType')}
            className="w-auto"
            value={leaveTypeId}
            onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
          >
            {activeTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
              </option>
            ))}
          </Select>
          <Input
            type="date"
            aria-label={t('hr.from')}
            className="w-auto"
            value={form.startDate}
            onChange={(e) =>
              setForm({
                ...form,
                startDate: e.target.value,
                endDate: form.endDate || e.target.value,
              })
            }
          />
          <Input
            type="date"
            aria-label={t('hr.to')}
            className="w-auto"
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          />
          <Input
            className="min-w-40 flex-1"
            placeholder={t('hr.reason')}
            aria-label={t('hr.reason')}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
          <Button
            type="submit"
            loading={request.isPending}
            disabled={!leaveTypeId || !form.startDate || !form.endDate}
          >
            {t('hr.requestLeave')}
          </Button>
        </form>
        {(request.error || cancel.error) && (
          <Alert>{errorMessage(request.error ?? cancel.error)}</Alert>
        )}
        {leave.data?.requests.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
          >
            <span>
              {r.leaveTypeName} · {formatDate(r.startDate)} → {formatDate(r.endDate)} ({r.days}{' '}
              {t('hr.days')})
            </span>
            <span className="flex items-center gap-2">
              <Badge variant={statusVariant(r.status)} dot>
                {statusLabel(r.status)}
              </Badge>
              {(r.status === 'PENDING' || (r.status === 'APPROVED' && r.startDate > today())) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="hover:text-destructive"
                  loading={cancel.isPending && cancel.variables === r.id}
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(r.id)}
                >
                  {t('hr.cancel')}
                </Button>
              )}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
