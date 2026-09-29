'use client'; // Error boundaries must be Client Components.

import { RouteError } from '@/components/staff-shell/route-error';

/** Replaces only the page area; the staff shell stays usable. */
export default function StaffError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError {...props} />;
}
