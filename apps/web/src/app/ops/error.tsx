'use client'; // Error boundaries must be Client Components.

import { RouteError } from '@/components/route-error';

/** The ops dashboard sits outside the staff shell, so the fallback brings its own frame. */
export default function OpsError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <RouteError {...props} />
    </main>
  );
}
