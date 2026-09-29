'use client';

import type { OpsSnapshot } from '@hotel/contracts';
import { formatDateTime } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  CardContent,
  cn,
  EmptyState,
  PageHeader,
  SectionCard,
  SkeletonCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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
import { timeAgo, timeSince } from '@/lib/time';

const when = (iso: string | null) => (iso ? formatDateTime(iso) : '—');

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

      <SectionCard icon={ListRestart} title={t('ops.queues')}>
        <CardContent className="flex flex-col gap-3 text-sm">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-0">{t('ops.queue')}</TableHead>
                <TableHead className="text-right">{t('ops.waiting')}</TableHead>
                <TableHead className="text-right">{t('ops.active')}</TableHead>
                <TableHead className="text-right">{t('ops.delayed')}</TableHead>
                <TableHead className="pr-0 text-right">{t('ops.failed')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {s.queues.map((q) => (
                <TableRow key={q.name}>
                  <TableCell className="pl-0 font-mono">{q.name}</TableCell>
                  <TableCell className="text-right">{q.waiting}</TableCell>
                  <TableCell className="text-right">{q.active}</TableCell>
                  <TableCell className="text-right">{q.delayed}</TableCell>
                  <TableCell
                    className={cn(
                      'pr-0 text-right',
                      q.failed > 0 && 'font-semibold text-destructive',
                    )}
                  >
                    {q.failed}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p
            className={cn('text-xs', schedulerLate ? 'text-destructive' : 'text-muted-foreground')}
          >
            {t('ops.schedulerAt', {
              time: s.schedulerRanAt ? timeAgo(s.schedulerRanAt) : t('ops.never'),
            })}
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
      </SectionCard>

      <SectionCard icon={Inbox} title={t('ops.outbox')}>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label={t('ops.pending')} value={s.outbox.pending} />
            <Stat
              label={t('ops.oldestPending')}
              value={s.outbox.oldestPendingAt ? timeSince(s.outbox.oldestPendingAt) : '—'}
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
      </SectionCard>

      <SectionCard icon={Webhook} title={t('ops.webhooks')}>
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
      </SectionCard>
    </div>
  );
}
