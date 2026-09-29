'use client';

import { Button, DocumentTitle, EmptyState } from '@hotel/ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { t } from '@/lib/i18n';

/** Fallback for an unexpected render error in a route segment (used by the error.tsx files). */
export function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <>
      <DocumentTitle title={t('error.pageTitle')} />
      <EmptyState
        icon={<TriangleAlert />}
        title={t('error.pageTitle')}
        description={t('error.generic')}
        action={
          <Button variant="outline" size="sm" onClick={() => retry()}>
            {t('error.retry')}
          </Button>
        }
      />
    </>
  );
}
