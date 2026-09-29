'use client';

import { type Quote } from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import { Button, Skeleton, Spinner } from '@hotel/ui';
import { type UseQueryResult } from '@tanstack/react-query';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';

/** The live quote for the chosen stay, next to the create button. */
export function QuoteSummary({
  quote,
  creating,
}: {
  quote: Pick<UseQueryResult<Quote>, 'isFetching' | 'data' | 'error'>;
  creating: boolean;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-4 sm:col-span-2">
      <div className="flex flex-col" aria-live="polite">
        <span className="text-xs text-muted-foreground">{t('res.quote')}</span>
        {quote.isFetching ? (
          <span className="flex items-center gap-2 py-1">
            <Spinner className="size-4 text-primary" />
            <Skeleton className="h-6 w-28" />
          </span>
        ) : quote.data ? (
          <span key={quote.data.totalMinor} className="animate-fade-in">
            <strong className="text-xl tabular-nums">
              {formatMoney(quote.data.totalMinor, quote.data.currency)}
            </strong>{' '}
            <span className="text-sm text-muted-foreground">
              · {t('res.nightsCount', { count: quote.data.nights.length })}
            </span>
          </span>
        ) : quote.error ? (
          <span className="text-sm text-destructive">{errorMessage(quote.error)}</span>
        ) : (
          <span className="text-xl text-muted-foreground">—</span>
        )}
      </div>
      <Button type="submit" size="lg" loading={creating} disabled={!quote.data}>
        {creating ? t('res.creating') : t('res.create')}
      </Button>
    </div>
  );
}
