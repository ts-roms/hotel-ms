'use client';

import type { OpsSnapshot } from '@hotel/contracts';
import { Alert, Notice } from '@hotel/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { OutboxCard } from './outbox-card';
import { QueuesCard } from './queues-card';
import { WebhooksCard } from './webhooks-card';

export function OpsDashboard({ snapshot: s }: { snapshot: OpsSnapshot }) {
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

  return (
    <div className="flex flex-col gap-4">
      {(retryJob.error || retryOutbox.error) && (
        <Alert>{errorMessage(retryJob.error ?? retryOutbox.error)}</Alert>
      )}
      {(retryJob.isSuccess || retryOutbox.isSuccess) && <Notice>{t('ops.retried')}</Notice>}

      <QueuesCard
        queues={s.queues}
        schedulerRanAt={s.schedulerRanAt}
        failedJobs={s.failedJobs}
        retryPending={retryJob.isPending}
        onRetry={(j) => retryJob.mutate(j)}
      />

      <OutboxCard
        outbox={s.outbox}
        retryPending={retryOutbox.isPending}
        onRetry={(id) => retryOutbox.mutate(id)}
      />

      <WebhooksCard webhooks={s.webhooks} />
    </div>
  );
}
