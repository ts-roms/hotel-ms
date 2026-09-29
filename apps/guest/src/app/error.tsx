'use client'; // Error boundaries must be Client Components.

import { Button, CardContent } from '@hotel/ui';
import { useEffect } from 'react';
import { GuestShell } from '@/components/guest-shell';
import { t } from '@/lib/i18n';

/** Fallback for an unexpected render error on any guest page. */
export default function GuestError({
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
    <GuestShell title={t('error.pageTitle')} description={t('error.generic')}>
      <CardContent className="flex justify-center">
        <Button variant="outline" onClick={() => retry()}>
          {t('error.retry')}
        </Button>
      </CardContent>
    </GuestShell>
  );
}
