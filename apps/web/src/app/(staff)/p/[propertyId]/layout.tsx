'use client';

import { ApiError } from '@hotel/api-client';
import { type ReactNode, useEffect } from 'react';
import {
  PropertyIdContext,
  rememberProperty,
  useProperty,
  useRoutePropertyId,
} from '@/lib/property';
import PropertyNotFound from './not-found';

/**
 * Owns the property context for every page under /p/[propertyId]: provides the id through
 * `usePropertyId()`, remembers the property for the next visit, and answers a property the
 * member cannot see with the not-found page. The API returns 404 for other tenants' and
 * out-of-scope properties alike (ADR-0004), so the UI does not tell them apart either.
 *
 * Pages render while the property loads (they fetch their own data in parallel); only a 404
 * replaces them.
 */
export default function PropertyLayout({ children }: { children: ReactNode }) {
  // Always present: this layout only matches /p/[propertyId]/...
  const propertyId = useRoutePropertyId()!;
  const property = useProperty(propertyId);
  const loaded = property.isSuccess;

  useEffect(() => {
    if (loaded) rememberProperty(propertyId);
  }, [loaded, propertyId]);

  // `notFound()` thrown here would skip this segment's own not-found.tsx (a layout sits above
  // its segment's boundaries), so render the same page directly.
  if (property.error instanceof ApiError && property.error.status === 404) {
    return <PropertyNotFound />;
  }
  return <PropertyIdContext value={propertyId}>{children}</PropertyIdContext>;
}
