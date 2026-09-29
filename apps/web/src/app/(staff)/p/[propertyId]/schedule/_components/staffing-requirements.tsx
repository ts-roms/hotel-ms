'use client';

import {
  Alert,
  Button,
  CardContent,
  Input,
  NativeSelect,
  SectionCard,
  WeekdayPicker,
  WEEKDAYS_MONDAY_FIRST,
  weekdayShortName,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, usePropertyId } from '@/lib/property';

/** Minimum staffing per department and time window (spec §35, ADR-0028). */
export function StaffingRequirements({ canManage }: { canManage: boolean }) {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const requirements = useQuery({
    queryKey: ['staffing-requirements', propertyId],
    queryFn: pms.staffingRequirements,
  });
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: api.hr.departments,
    enabled: canManage,
  });
  const [form, setForm] = useState({
    departmentId: '',
    weekdays: [1, 2, 3, 4, 5, 6, 0] as number[],
    startTime: '08:00',
    endTime: '17:00',
    minStaff: '2',
  });
  const departmentId = form.departmentId || departments.data?.find((d) => !d.archived)?.id || '';
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['staffing-requirements', propertyId] });
    void queryClient.invalidateQueries({ queryKey: ['coverage', propertyId] });
  };
  const create = useMutation({
    mutationFn: () =>
      pms.createStaffingRequirement({
        departmentId,
        weekdays: form.weekdays,
        startTime: form.startTime,
        endTime: form.endTime,
        minStaff: Number(form.minStaff),
      }),
    onSuccess: refresh,
  });
  const archive = useMutation({
    mutationFn: (id: string) => pms.archiveStaffingRequirement(id),
    onSuccess: refresh,
  });
  if (!canManage && !requirements.data?.length) return null;

  return (
    <SectionCard className="animate-fade-in" icon={Users} title={t('sched.minimumStaffing')}>
      <CardContent className="flex flex-col gap-3 text-sm">
        {requirements.data?.length === 0 && (
          <p className="text-muted-foreground">{t('sched.noRequirements')}</p>
        )}
        {requirements.data?.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <span>
              <strong>{r.departmentName}</strong> · {r.startTime}–{r.endTime} ·{' '}
              {WEEKDAYS_MONDAY_FIRST.filter((d) => r.weekdays.includes(d))
                .map(weekdayShortName)
                .join(', ')}
            </span>
            <span className="flex items-center gap-2">
              {t('sched.atLeast')} <strong>{r.minStaff}</strong>
              {canManage && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('hrx.remove')}
                  disabled={archive.isPending}
                  onClick={() => archive.mutate(r.id)}
                >
                  <Trash2 />
                </Button>
              )}
            </span>
          </div>
        ))}
        {canManage && (
          <form
            className="flex flex-col gap-2 border-t pt-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                className="w-auto"
                aria-label={t('hr.department')}
                value={departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              >
                {departments.data
                  ?.filter((d) => !d.archived)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </NativeSelect>
              <Input
                type="time"
                className="w-auto"
                aria-label={t('cal.starts')}
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              />
              <span>–</span>
              <Input
                type="time"
                className="w-auto"
                aria-label={t('cal.ends')}
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              />
              <Input
                type="number"
                min={1}
                max={200}
                className="w-20"
                aria-label={t('sched.minStaff')}
                value={form.minStaff}
                onChange={(e) => setForm({ ...form, minStaff: e.target.value })}
              />
              <span className="text-muted-foreground">{t('sched.people').toLowerCase()}</span>
            </div>
            <WeekdayPicker
              label={t('sched.weekdays')}
              value={form.weekdays}
              onChange={(weekdays) => setForm({ ...form, weekdays })}
            />
            {create.error && <Alert>{errorMessage(create.error)}</Alert>}
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="self-start"
              loading={create.isPending}
              disabled={!departmentId || form.weekdays.length === 0 || !Number(form.minStaff)}
            >
              {t('sched.addRequirement')}
            </Button>
          </form>
        )}
      </CardContent>
    </SectionCard>
  );
}
