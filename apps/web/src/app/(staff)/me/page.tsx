'use client';

import { Alert, LoadingRegion, Notice, PageHeader, Skeleton, SkeletonCard } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { hasPermission, useSession } from '@/lib/session';
import { MyAttendance } from './_components/my-attendance';
import { MyLeave } from './_components/my-leave';
import { MyShifts } from './_components/my-shifts';
import { TimeClock } from './_components/time-clock';

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
        {hasPermission(session.data, 'attendance.punch.own') && <TimeClock />}
        {hasPermission(session.data, 'schedule.read.own') && <MyShifts />}
        {hasPermission(session.data, 'attendance.punch.own') && <MyAttendance />}
        {hasPermission(session.data, 'leave.request.own') && <MyLeave />}
      </div>
    </div>
  );
}
