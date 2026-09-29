'use client';

import { formatDate } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  CardContent,
  Input,
  NativeSelect,
  SectionCard,
  Skeleton,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plane } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { today } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { statusLabel, statusVariant } from '@/lib/status';

export function MyLeave() {
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
    <SectionCard icon={Plane} title={t('hr.myLeave')}>
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
              {b.leaveTypeName}: {t('common.daysCount', { count: b.days })}
            </Badge>
          ))}
        </div>
        <form
          onSubmit={onSubmit}
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/40 p-3"
          noValidate
        >
          <NativeSelect
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
          </NativeSelect>
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
    </SectionCard>
  );
}
