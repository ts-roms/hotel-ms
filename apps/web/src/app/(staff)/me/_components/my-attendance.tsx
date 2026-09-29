'use client';

import type { PunchType } from '@hotel/contracts';
import { addDays, formatDate, localDate } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  CardContent,
  Input,
  Label,
  NativeSelect,
  SectionCard,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock as ClockIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { clock, duration, PUNCH_LABEL, today } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { statusLabel, statusVariant } from '@/lib/status';

export function MyAttendance() {
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
    <SectionCard icon={ClockIcon} title={t('hr.myAttendance')}>
      <CardContent className="flex flex-col gap-4 text-sm">
        {days.isPending && <SkeletonTable rows={4} columns={6} />}
        <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <TableHeader>
            <TableRow>
              <TableHead>{t('hr.date')}</TableHead>
              <TableHead>{t('hr.status')}</TableHead>
              <TableHead>{t('hr.in')}</TableHead>
              <TableHead>{t('hr.out')}</TableHead>
              <TableHead>{t('hr.worked')}</TableHead>
              <TableHead>{t('hr.late')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular-nums">
            {days.data?.map((d) => (
              <TableRow key={`${d.date}-${d.shift?.startsAt ?? ''}`}>
                <TableCell>{formatDate(d.date)}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(d.status)} dot>
                    {statusLabel(d.status)}
                  </Badge>
                </TableCell>
                <TableCell>{clock(d.firstIn)}</TableCell>
                <TableCell>{clock(d.lastOut)}</TableCell>
                <TableCell>{duration(d.workedMinutes)}</TableCell>
                <TableCell>{duration(d.lateMinutes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <form
          onSubmit={onSubmit}
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/40 p-3"
          noValidate
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="corr-type">{t('hr.missedPunch')}</Label>
            <NativeSelect
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
            </NativeSelect>
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
              {t(PUNCH_LABEL[c.type])} · {formatDate(localDate(c.at))} {clock(c.at)}
            </span>
            <Badge variant={statusVariant(c.status)} dot>
              {statusLabel(c.status)}
            </Badge>
          </div>
        ))}
      </CardContent>
    </SectionCard>
  );
}
