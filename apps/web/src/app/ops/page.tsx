'use client';

import type { OpsSnapshot } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  PageHeader,
  SkeletonCard,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft, Inbox, ListRestart, Webhook } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** Seconds (or minutes, hours) since an instant, for "5 min ago". */
function age(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-PH') : '—');

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
                ? `${t('ops.updated')} ${age(overview.data.snapshot.generatedAt)} ${t('ops.ago')}`
                : t('ops.hint')
            }
          />
          {overview.error && <Alert>{errorMessage(overview.error)}</Alert>}
          {overview.isPending && <SkeletonCard lines={6} />}
          {overview.data && !overview.data.snapshot && <Alert>{t('ops.workerSilent')}</Alert>}
          {overview.data?.snapshot && <Dashboard snapshot={overview.data.snapshot} />}
        </>
      )}
    </main>
  );
}

function Stat({ label, value, alert }: { label: string; value: ReactNode; alert?: boolean }) {
  return (
    <div className={cn('rounded-lg border p-3', alert && 'border-destructive/50 bg-destructive/5')}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-semibold tabular-nums', alert && 'text-destructive')}>
        {value}
      </p>
    </div>
  );
}

function Dashboard({ snapshot: s }: { snapshot: OpsSnapshot }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ops-overview'] });
  const retryJob = useMutation({
    mutationFn: (j: { queue: string; id: string }) => api.ops.retryJob(j.queue, j.id),
    onSuccess: refresh,
  });
  const retryOutbox = useMutation({
    mutationFn: (id: string) => api.ops.retryOutbox(id),
    onSuccess: refresh,
  });
  const backlogMinutes = s.outbox.oldestPendingAt
    ? (Date.now() - Date.parse(s.outbox.oldestPendingAt)) / 60_000
    : 0;
  const schedulerLate =
    !s.schedulerRanAt || Date.now() - Date.parse(s.schedulerRanAt) > 15 * 60_000;

  return (
    <div className="flex flex-col gap-4">
      {(retryJob.error || retryOutbox.error) && (
        <Alert>{errorMessage(retryJob.error ?? retryOutbox.error)}</Alert>
      )}
      {(retryJob.isSuccess || retryOutbox.isSuccess) && (
        <Alert className="border-primary/30 bg-primary/5 text-foreground">{t('ops.retried')}</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListRestart className="size-4 text-primary" />
            {t('ops.queues')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">{t('ops.queue')}</th>
                  <th className="px-3 text-right">{t('ops.waiting')}</th>
                  <th className="px-3 text-right">{t('ops.active')}</th>
                  <th className="px-3 text-right">{t('ops.delayed')}</th>
                  <th className="pl-3 text-right">{t('ops.failed')}</th>
                </tr>
              </thead>
              <tbody>
                {s.queues.map((q) => (
                  <tr key={q.name} className="border-t">
                    <td className="py-2 pr-3 font-mono">{q.name}</td>
                    <td className="px-3 text-right tabular-nums">{q.waiting}</td>
                    <td className="px-3 text-right tabular-nums">{q.active}</td>
                    <td className="px-3 text-right tabular-nums">{q.delayed}</td>
                    <td
                      className={cn(
                        'pl-3 text-right tabular-nums',
                        q.failed > 0 && 'font-semibold text-destructive',
                      )}
                    >
                      {q.failed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p
            className={cn('text-xs', schedulerLate ? 'text-destructive' : 'text-muted-foreground')}
          >
            {t('ops.scheduler')}:{' '}
            {s.schedulerRanAt ? `${age(s.schedulerRanAt)} ${t('ops.ago')}` : t('ops.never')}
          </p>
          {s.failedJobs.length > 0 && (
            <div className="flex flex-col gap-2 border-t pt-3">
              <p className="font-medium">{t('ops.failedJobs')}</p>
              {s.failedJobs.map((j) => (
                <div
                  key={`${j.queue}:${j.id}`}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-mono text-xs text-muted-foreground">
                      {j.queue} · {j.name} · #{j.id} · {when(j.failedAt)} · {j.attempts}×
                    </span>
                    <span className="break-words">{j.reason}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={retryJob.isPending}
                    onClick={() => retryJob.mutate({ queue: j.queue, id: j.id })}
                  >
                    {t('ops.retry')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="size-4 text-primary" />
            {t('ops.outbox')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label={t('ops.pending')} value={s.outbox.pending} />
            <Stat
              label={t('ops.oldestPending')}
              value={age(s.outbox.oldestPendingAt)}
              alert={backlogMinutes > 5}
            />
            <Stat label={t('ops.retrying')} value={s.outbox.retrying} />
            <Stat label={t('ops.stuck')} value={s.outbox.stuck} alert={s.outbox.stuck > 0} />
          </div>
          {s.outbox.failures.map((f) => (
            <div
              key={f.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono">{f.type}</span> ·{' '}
                  <span className="font-mono">{f.organizationId.slice(0, 8)}</span> ·{' '}
                  {when(f.occurredAt)} · {f.attempts}/{s.outbox.maxAttempts}
                </span>
                <span className="break-words">{f.lastError ?? '—'}</span>
              </span>
              <span className="flex items-center gap-2">
                {f.attempts >= s.outbox.maxAttempts && (
                  <Badge variant="danger" dot>
                    {t('ops.stuckBadge')}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retryOutbox.isPending}
                  onClick={() => retryOutbox.mutate(f.id)}
                >
                  {t('ops.retry')}
                </Button>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="size-4 text-primary" />
            {t('ops.webhooks')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label={t('ops.received24h')} value={s.webhooks.received24h} />
            <Stat
              label={t('ops.failed24h')}
              value={s.webhooks.failed24h}
              alert={s.webhooks.failed24h > 0}
            />
            <Stat
              label={t('ops.unprocessed')}
              value={s.webhooks.unprocessed}
              alert={s.webhooks.unprocessed > 0}
            />
          </div>
          {s.webhooks.failures.map((w) => (
            <div key={w.id} className="flex flex-col rounded-lg border p-3">
              <span className="text-xs text-muted-foreground">
                {w.provider} · <span className="font-mono">{w.eventType}</span> ·{' '}
                {when(w.receivedAt)} · {w.attempts}×
              </span>
              <span className="break-words">{w.lastError ?? '—'}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
