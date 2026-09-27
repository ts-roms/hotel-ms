'use client';

import { Alert, Card, CardContent, CardHeader, CardTitle } from '@hotel/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, rememberStay, tokenFromHash } from '@/lib/api';

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
      setError('This link is incomplete. Open it again from your email.');
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
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert>{error}</Alert>
          ) : (
            <p className="text-muted-foreground">Opening your booking…</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
