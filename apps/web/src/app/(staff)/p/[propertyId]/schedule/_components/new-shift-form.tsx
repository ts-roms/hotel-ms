'use client';

import type { ShiftWarning } from '@hotel/contracts';
import { Alert, Button, Card, CardContent, Input, Notice, NativeSelect } from '@hotel/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, usePropertyId } from '@/lib/property';

export function NewShift({
  employees,
  days,
  onCreated,
}: {
  employees: { id: string; name: string }[];
  days: string[];
  onCreated: () => void;
}) {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const templates = useQuery({
    queryKey: ['shift-templates', propertyId],
    queryFn: pms.shiftTemplates,
  });
  const [form, setForm] = useState({ employeeId: '', date: days[0]!, templateId: '' });
  const [warnings, setWarnings] = useState<ShiftWarning[]>([]);
  // '' means "not chosen yet": show and submit the first option. The templates load after
  // the first render, so the select must be given that option explicitly or it shows blank.
  const employeeId = form.employeeId || employees[0]?.id || '';
  const templateId = form.templateId || templates.data?.[0]?.id || '';
  const create = useMutation({
    mutationFn: () =>
      pms.createShift({
        employeeId,
        date: form.date,
        templateId,
        departmentId: null,
        notes: '',
      }),
    onSuccess: (shift) => {
      setWarnings(shift.warnings);
      onCreated();
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <Card className="animate-fade-in">
      <CardContent className="flex flex-col gap-2 pt-5">
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2" noValidate>
          <NativeSelect
            className="w-auto"
            aria-label={t('hr.employee')}
            value={employeeId}
            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </NativeSelect>
          <Input
            type="date"
            className="w-auto"
            aria-label={t('hr.date')}
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
          <NativeSelect
            className="w-auto"
            aria-label={t('hr.shiftTemplate')}
            value={templateId}
            onChange={(e) => setForm({ ...form, templateId: e.target.value })}
          >
            {templates.data?.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} {tpl.startTime}–{tpl.endTime}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" loading={create.isPending} disabled={!employeeId || !templateId}>
            {!create.isPending && <Plus />}
            {t('hr.addShift')}
          </Button>
        </form>
        {create.error && <Alert>{errorMessage(create.error)}</Alert>}
        {warnings.map((w) => (
          <Notice key={w.code} className="border-warning/30 bg-warning/10">
            {w.message}
          </Notice>
        ))}
      </CardContent>
    </Card>
  );
}
