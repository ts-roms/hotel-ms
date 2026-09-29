'use client';

import type { OpsSnapshot } from '@hotel/contracts';
import { Badge, Button, CardContent, SectionCard, StatCard } from '@hotel/ui';
import { Inbox } from 'lucide-react';
import { t } from '@/lib/i18n';
import { timeSince } from '@/lib/time';
import { when } from './when';

export function OutboxCard({
  outbox,
  retryPending,
  onRetry,
}: {
  outbox: OpsSnapshot['outbox'];
  retryPending: boolean;
  onRetry: (id: string) => void;
}) {
  const backlogMinutes = outbox.oldestPendingAt
    ? (Date.now() - Date.parse(outbox.oldestPendingAt)) / 60_000
    : 0;

  return (
    <SectionCard icon={Inbox} title={t('ops.outbox')}>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-4">
          <StatCard compact label={t('ops.pending')} value={outbox.pending} />
          <StatCard
            compact
            label={t('ops.oldestPending')}
            value={outbox.oldestPendingAt ? timeSince(outbox.oldestPendingAt) : '—'}
            alert={backlogMinutes > 5}
          />
          <StatCard compact label={t('ops.retrying')} value={outbox.retrying} />
          <StatCard compact label={t('ops.stuck')} value={outbox.stuck} alert={outbox.stuck > 0} />
        </div>
        {outbox.failures.map((f) => (
          <div
            key={f.id}
            className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-xs text-muted-foreground">
                <span className="font-mono">{f.type}</span> ·{' '}
                <span className="font-mono">{f.organizationId.slice(0, 8)}</span> ·{' '}
                {when(f.occurredAt)} · {f.attempts}/{outbox.maxAttempts}
              </span>
              <span className="break-words">{f.lastError ?? '—'}</span>
            </span>
            <span className="flex items-center gap-2">
              {f.attempts >= outbox.maxAttempts && (
                <Badge variant="danger" dot>
                  {t('ops.stuckBadge')}
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={retryPending}
                onClick={() => onRetry(f.id)}
              >
                {t('ops.retry')}
              </Button>
            </span>
          </div>
        ))}
      </CardContent>
    </SectionCard>
  );
}
