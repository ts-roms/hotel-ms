'use client';

import { tokenFromHash } from '@hotel/api-client';
import { Alert, buttonVariants, CardContent, Spinner } from '@hotel/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { GuestShell } from '@/components/guest-shell';
import { api, errorMessage, rememberStay } from '@/lib/api';
import { t } from '@/lib/i18n';

/** Landing page of the emailed link: trades the token for a session, then opens the stay. */
export default function WelcomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Effects can run twice in strict mode; the token must be exchanged exactly once.
    if (started.current) return;
    started.current = true;
    const token = tokenFromHash();
    history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setError(t('welcome.incomplete'));
      return;
    }
    api
      .exchange(token)
      .then((stay) => {
        queryClient.setQueryData(['stay'], rememberStay(stay));
        router.replace('/stay');
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [queryClient, router]);

  return (
    <GuestShell title={t('welcome.title')}>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <>
            <Alert>{error}</Alert>
            <Link href="/" className={buttonVariants({ variant: 'outline' })}>
              {t('welcome.back')}
            </Link>
          </>
        ) : (
          <div
            role="status"
            className="flex flex-col items-center gap-3 py-4 text-muted-foreground"
          >
            <Spinner className="size-7 text-primary" />
            {t('welcome.opening')}
          </div>
        )}
      </CardContent>
    </GuestShell>
  );
}
