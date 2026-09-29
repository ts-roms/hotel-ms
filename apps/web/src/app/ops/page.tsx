'use client';

import { Alert, EmptyState, PageHeader, SkeletonCard } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { timeAgo } from '@/lib/time';
import { OpsDashboard } from './_components/ops-dashboard';

/**
 * Operations dashboard for platform operators (ADR-0029): queues and failed jobs, the
 * outbox backlog, payment webhooks and the scheduler, from the worker's snapshot.
 * Outside the organization shell: operators need not belong to any organization.
 */
export default function OpsPage() {
  const router = useRouter();
  const session = useSession();
  const info = session.data;
  useEffect(() => {
    if (info === null) router.replace('/login');
  }, [info, router]);
  const allowed = !!info?.identity.platformOperator;
  const overview = useQuery({
    queryKey: ['ops-overview'],
    queryFn: api.ops.overview,
    enabled: allowed,
    refetchInterval: 15_000,
  });

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <Link
        href="/dashboard"
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>
      {info && !allowed && <EmptyState icon={<Activity />} title={t('ops.notOperator')} />}
      {allowed && (
        <>
          <PageHeader
            title={t('ops.title')}
            description={
              overview.data?.snapshot
                ? t('ops.updatedAt', { time: timeAgo(overview.data.snapshot.generatedAt) })
                : t('ops.hint')
            }
          />
          {overview.error && <Alert>{errorMessage(overview.error)}</Alert>}
          {overview.isPending && <SkeletonCard lines={6} />}
          {overview.data && !overview.data.snapshot && <Alert>{t('ops.workerSilent')}</Alert>}
          {overview.data?.snapshot && <OpsDashboard snapshot={overview.data.snapshot} />}
        </>
      )}
    </main>
  );
}
