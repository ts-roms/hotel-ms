import type { OpsSnapshot } from '@hotel/contracts';
import { CardContent, SectionCard, StatCard } from '@hotel/ui';
import { Webhook } from 'lucide-react';
import { t } from '@/lib/i18n';
import { when } from './when';

export function WebhooksCard({ webhooks }: { webhooks: OpsSnapshot['webhooks'] }) {
  return (
    <SectionCard icon={Webhook} title={t('ops.webhooks')}>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-3">
          <StatCard compact label={t('ops.received24h')} value={webhooks.received24h} />
          <StatCard
            compact
            label={t('ops.failed24h')}
            value={webhooks.failed24h}
            alert={webhooks.failed24h > 0}
          />
          <StatCard
            compact
            label={t('ops.unprocessed')}
            value={webhooks.unprocessed}
            alert={webhooks.unprocessed > 0}
          />
        </div>
        {webhooks.failures.map((w) => (
          <div key={w.id} className="flex flex-col rounded-lg border p-3">
            <span className="text-xs text-muted-foreground">
              {w.provider} · <span className="font-mono">{w.eventType}</span> · {when(w.receivedAt)}{' '}
              · {w.attempts}×
            </span>
            <span className="break-words">{w.lastError ?? '—'}</span>
          </div>
        ))}
      </CardContent>
    </SectionCard>
  );
}
