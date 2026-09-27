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
  Notice,
  Select,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDate } from '@/lib/format';
import { clock, duration, mondayOf, PUNCH_NEXT, today } from '@/lib/hr';
import { type MessageKey, t } from '@/lib/i18n';
import { hasPermission, useSession } from '@/lib/session';

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

  if (me.isPending) return <p className="text-muted-foreground">{t('loading')}</p>;
  if (me.error) return <Alert>{errorMessage(me.error)}</Alert>;
  if (!me.data.employee) return <Notice>{t('hr.notEmployee')}</Notice>;

  const employee = me.data.employee;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">
        {t('hr.myTime')} · {employee.preferredName || employee.firstName} {employee.lastName}
      </h1>
      {hasPermission(session.data, 'attendance.punch.own') && <Clock />}
      {hasPermission(session.data, 'schedule.read.own') && <MyShifts />}
      {hasPermission(session.data, 'attendance.punch.own') && <MyAttendance />}
      {hasPermission(session.data, 'leave.request.own') && <MyLeave />}
    </div>
  );
}

function Clock() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me', 'employee'], queryFn: api.me.employee });
  const punch = useMutation({
    mutationFn: (input: { propertyId: string; type: PunchType }) =>
      api.pms(input.propertyId).punch(input.type),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  });
  const employee = me.data?.employee;
  if (!employee) return null;
  const last = me.data?.lastPunch;
  const state = last?.type ?? 'NONE';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('hr.clock')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {punch.error && <Alert>{errorMessage(punch.error)}</Alert>}
        <p className="text-muted-foreground">
          {last
            ? `${t(PUNCH_LABEL[last.type])} · ${formatDate(last.at.slice(0, 10))} ${clock(last.at)}`
            : t('hr.noPunches')}
        </p>
        {employee.assignments.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-40">{a.propertyName}</span>
            {PUNCH_NEXT[state]!.map((type) => (
              <Button
                key={type}
                size="sm"
                variant={type === 'IN' || type === 'OUT' ? 'default' : 'outline'}
                disabled={punch.isPending}
                onClick={() => punch.mutate({ propertyId: a.propertyId, type })}
              >
                {t(PUNCH_LABEL[type])}
              </Button>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
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
        <CardTitle className="text-base">{t('hr.myShifts')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        {shifts.data?.length === 0 && <p className="text-muted-foreground">{t('hr.noShifts')}</p>}
        {shifts.data?.map((s) => (
          <div key={s.id} className="flex justify-between gap-2">
            <span>{formatDate(s.date)}</span>
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
        <CardTitle className="text-base">{t('hr.myAttendance')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <table className="w-full text-left">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1">{t('hr.date')}</th>
              <th>{t('hr.status')}</th>
              <th>{t('hr.in')}</th>
              <th>{t('hr.out')}</th>
              <th>{t('hr.worked')}</th>
              <th>{t('hr.late')}</th>
            </tr>
          </thead>
          <tbody>
            {days.data?.map((d) => (
              <tr key={`${d.date}-${d.shift?.startsAt ?? ''}`} className="border-t">
                <td className="py-1">{formatDate(d.date)}</td>
                <td>
                  <Badge>{d.status.toLowerCase().replace('_', ' ')}</Badge>
                </td>
                <td>{clock(d.firstIn)}</td>
                <td>{clock(d.lastOut)}</td>
                <td>{duration(d.workedMinutes)}</td>
                <td>{duration(d.lateMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2" noValidate>
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
            disabled={!form.at || form.reason.trim().length < 3 || !propertyId || request.isPending}
          >
            {t('hr.requestCorrection')}
          </Button>
        </form>
        {request.error && <Alert>{errorMessage(request.error)}</Alert>}
        {corrections.data?.slice(0, 5).map((c) => (
          <div key={c.id} className="flex justify-between gap-2 text-muted-foreground">
            <span>
              {t(PUNCH_LABEL[c.type])} · {formatDate(c.at.slice(0, 10))} {clock(c.at)}
            </span>
            <Badge>{c.status.toLowerCase()}</Badge>
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
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me', 'leave'] });
  const request = useMutation({
    mutationFn: () =>
      api.me.requestLeave({ ...form, leaveTypeId: form.leaveTypeId || types.data![0]!.id }),
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
  const activeTypes = types.data?.filter((lt) => !lt.archived) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('hr.myLeave')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap gap-2">
          {leave.data?.balances.map((b) => (
            <Badge key={b.leaveTypeId}>
              {b.leaveTypeName}: {b.days} {t('hr.days')}
            </Badge>
          ))}
        </div>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2" noValidate>
          <Select
            aria-label={t('hr.leaveType')}
            className="w-auto"
            value={form.leaveTypeId}
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
          <Button type="submit" disabled={!form.startDate || !form.endDate || request.isPending}>
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
              <Badge>{r.status.toLowerCase()}</Badge>
              {(r.status === 'PENDING' || (r.status === 'APPROVED' && r.startDate > today())) && (
                <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>
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
