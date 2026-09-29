'use client'; // Error boundaries must be Client Components.

import { RouteError } from '@/components/route-error';

/** Inside the sign-in backdrop, so the brand stays in place. */
export default function AuthError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError {...props} />;
}
