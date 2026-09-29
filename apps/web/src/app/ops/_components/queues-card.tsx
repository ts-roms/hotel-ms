'use client';

import type { OpsSnapshot } from '@hotel/contracts';
import {
  Button,
  CardContent,
  cn,
  SectionCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { ListRestart } from 'lucide-react';
import { t } from '@/lib/i18n';
import { timeAgo } from '@/lib/time';
import { when } from './when';

export function QueuesCard({
  queues,
  schedulerRanAt,
  failedJobs,
  retryPending,
  onRetry,
}: {
  queues: OpsSnapshot['queues'];
  schedulerRanAt: OpsSnapshot['schedulerRanAt'];
  failedJobs: OpsSnapshot['failedJobs'];
  retryPending: boolean;
  onRetry: (job: { queue: string; id: string }) => void;
}) {
  const schedulerLate = !schedulerRanAt || Date.now() - Date.parse(schedulerRanAt) > 15 * 60_000;

  return (
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
            {queues.map((q) => (
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
        <p className={cn('text-xs', schedulerLate ? 'text-destructive' : 'text-muted-foreground')}>
          {t('ops.schedulerAt', {
            time: schedulerRanAt ? timeAgo(schedulerRanAt) : t('ops.never'),
          })}
        </p>
        {failedJobs.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="font-medium">{t('ops.failedJobs')}</p>
            {failedJobs.map((j) => (
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
                  disabled={retryPending}
                  onClick={() => onRetry({ queue: j.queue, id: j.id })}
                >
                  {t('ops.retry')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </SectionCard>
  );
}
