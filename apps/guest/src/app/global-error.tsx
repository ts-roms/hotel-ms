'use client'; // Error boundaries must be Client Components.

import { Button } from '@hotel/ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { t } from '@/lib/i18n';
import './globals.css';

/**
 * Last-resort fallback when the root layout itself fails. It replaces the whole document, so it
 * brings its own <html>, styles and title (no Metadata API in a client boundary).
 */
export default function GlobalError({
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
    <html lang="en">
      <body className="guest-backdrop min-h-dvh antialiased">
        <title>{t('app.pageTitle', { page: t('error.pageTitle'), app: t('app.name') })}</title>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-4 text-center">
          <TriangleAlert className="size-8 text-destructive" aria-hidden="true" />
          <h1 className="text-lg font-semibold">{t('error.pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('error.generic')}</p>
          <Button variant="outline" onClick={() => retry()}>
            {t('error.retry')}
          </Button>
        </main>
      </body>
    </html>
  );
}
