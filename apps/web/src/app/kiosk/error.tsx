'use client'; // Error boundaries must be Client Components.

import { RouteError } from '@/components/route-error';

/** A shared device must never be left on a blank screen: offer to try again. */
export default function KioskError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <RouteError {...props} />
    </main>
  );
}
