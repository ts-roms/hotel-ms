'use client';

import { type TrainingRecord } from '@hotel/contracts';
import { formatDate } from '@hotel/format';
import { Alert, Badge, Button, Input, Label, NativeSelect } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, ClipboardCheck, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { enumLabel } from '@/lib/status';
import { RecordSection } from './record-section';

const EXPIRY_BADGE: Record<
  NonNullable<TrainingRecord['expiry']>,
  'success' | 'warning' | 'danger'
> = {
  VALID: 'success',
  EXPIRING: 'warning',
  EXPIRED: 'danger',
};

/** Trainings and certifications (employee.read; employee.manage records them). */
export function TrainingCard({
  employeeId,
  canManage,
}: {
  employeeId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const records = useQuery({
    queryKey: ['training', employeeId],
    queryFn: () => api.hr.trainings(employeeId),
  });
  const empty = {
    kind: 'CERTIFICATION' as TrainingRecord['kind'],
    title: '',
    provider: '',
    completedOn: '',
    expiresOn: '',
  };
  const [form, setForm] = useState(empty);
  const set = (items: TrainingRecord[]) =>
    queryClient.setQueryData(['training', employeeId], items);
  const add = useMutation({
    mutationFn: () =>
      api.hr.addTraining(employeeId, {
        kind: form.kind,
        title: form.title,
        provider: form.provider,
        completedOn: form.completedOn || null,
        expiresOn: form.expiresOn || null,
      }),
    onSuccess: (items) => {
      set(items);
      setForm(empty);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.hr.removeTraining(employeeId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['training', employeeId] }),
  });

  return (
    <RecordSection icon={<Award />} title={t('hrx.training')}>
      {records.error && <Alert>{errorMessage(records.error)}</Alert>}
      {records.data?.length === 0 && <p className="text-muted-foreground">{t('hrx.none')}</p>}
      {records.data?.map((r) => (
        <div
          key={r.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
        >
          <span className="flex flex-col">
            <span className="font-medium">
              {r.title}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {enumLabel('trainingKind', r.kind)}
              </span>
            </span>
            <span className="text-muted-foreground">
              {[r.provider, r.completedOn && `${t('hrx.completed')} ${formatDate(r.completedOn)}`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {r.expiresOn && r.expiry && (
              <Badge variant={EXPIRY_BADGE[r.expiry]} dot>
                {t(`hrx.expiry.${r.expiry}` as 'hrx.expiry.VALID')} {formatDate(r.expiresOn)}
              </Badge>
            )}
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('hrx.remove')}
                disabled={remove.isPending}
                onClick={() => remove.mutate(r.id)}
              >
                <Trash2 />
              </Button>
            )}
          </span>
        </div>
      ))}
      {canManage && (
        <form
          className="grid gap-2 border-t pt-3 sm:grid-cols-2"
          onSubmit={(ev: FormEvent) => {
            ev.preventDefault();
            add.mutate();
          }}
        >
          <NativeSelect
            aria-label={t('hrx.kind')}
            value={form.kind}
            onChange={(ev) => setForm({ ...form, kind: ev.target.value as TrainingRecord['kind'] })}
          >
            <option value="CERTIFICATION">{enumLabel('trainingKind', 'CERTIFICATION')}</option>
            <option value="TRAINING">{enumLabel('trainingKind', 'TRAINING')}</option>
          </NativeSelect>
          <Input
            required
            maxLength={160}
            aria-label={t('hrx.title')}
            placeholder={t('hrx.title')}
            value={form.title}
            onChange={(ev) => setForm({ ...form, title: ev.target.value })}
          />
          <Input
            maxLength={160}
            aria-label={t('hrx.provider')}
            placeholder={t('hrx.provider')}
            value={form.provider}
            onChange={(ev) => setForm({ ...form, provider: ev.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <Label className="flex flex-col gap-1 text-xs">
              {t('hrx.completed')}
              <Input
                type="date"
                value={form.completedOn}
                onChange={(ev) => setForm({ ...form, completedOn: ev.target.value })}
              />
            </Label>
            <Label className="flex flex-col gap-1 text-xs">
              {t('hrx.expires')}
              <Input
                type="date"
                value={form.expiresOn}
                onChange={(ev) => setForm({ ...form, expiresOn: ev.target.value })}
              />
            </Label>
          </div>
          <Button
            type="submit"
            variant="outline"
            className="self-start"
            loading={add.isPending}
            disabled={!form.title.trim()}
          >
            <ClipboardCheck />
            {t('hrx.addRecord')}
          </Button>
          {add.error && <Alert className="sm:col-span-2">{errorMessage(add.error)}</Alert>}
        </form>
      )}
    </RecordSection>
  );
}
