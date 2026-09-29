'use client';

import { addDays, formatDate, localToday, startOfWeek } from '@hotel/format';
import { CardContent, SectionCard, SkeletonTable } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

export function MyShifts() {
  const monday = startOfWeek(localToday());
  const shifts = useQuery({
    queryKey: ['me', 'shifts', monday],
    queryFn: () => api.me.shifts(monday, addDays(monday, 13)),
  });
  return (
    <SectionCard icon={CalendarClock} title={t('hr.myShifts')}>
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
              s.date === localToday()
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
    </SectionCard>
  );
}
