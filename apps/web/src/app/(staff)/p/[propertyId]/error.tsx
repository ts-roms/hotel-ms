'use client'; // Error boundaries must be Client Components.

import { RouteError } from '@/components/staff-shell/route-error';

/** Inside the property layout, so the property context and shell stay in place. */
export default function PropertyError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError {...props} />;
}
