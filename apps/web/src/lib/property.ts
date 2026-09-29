'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { createContext, useContext } from 'react';
import { api } from './api';
import { hasPropertyPermission } from './permissions';
import { useSession } from './session';

const LAST_PROPERTY_KEY = 'hotel.lastPropertyId';

export function useProperties() {
  return useQuery({ queryKey: ['properties'], queryFn: () => api.properties.list({ limit: 100 }) });
}

/** The property in the URL (/p/[propertyId]/...), if any. */
export function useRoutePropertyId(): string | undefined {
  const params = useParams<{ propertyId?: string }>();
  return params?.propertyId;
}

/** Provided by app/(staff)/p/[propertyId]/layout.tsx once the route's property is known. */
export const PropertyIdContext = createContext<string | undefined>(undefined);

/** The current property, for components under /p/[propertyId]. */
export function usePropertyId(): string {
  const propertyId = useContext(PropertyIdContext);
  if (!propertyId) throw new Error('usePropertyId() is only available under /p/[propertyId]');
  return propertyId;
}

/**
 * Permission check for the current property: `can('folio.read')` is true for an
 * organization-wide grant or a grant at this property. Use it for everything under
 * /p/[propertyId]; `hasPermission` answers "anywhere in the organization" instead.
 */
export function useCan(): (permission: string) => boolean {
  const propertyId = usePropertyId();
  const session = useSession();
  return (permission) => hasPropertyPermission(session.data, permission, propertyId);
}

/** Property details, including its business date, currency and time zone. */
export function useProperty(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.properties.get(propertyId!).then((r) => r.data),
    enabled: !!propertyId,
  });
}

/**
 * The current property's IANA time zone, for showing instants and "today" in hotel time rather
 * than the device's. Undefined while the property loads (formatters then use the device zone).
 */
export function usePropertyTimeZone(): string | undefined {
  return useProperty(usePropertyId()).data?.timezone;
}

/** PMS client bound to a property. */
export function usePms(propertyId: string) {
  return api.pms(propertyId);
}

export function rememberProperty(propertyId: string): void {
  try {
    localStorage.setItem(LAST_PROPERTY_KEY, propertyId);
  } catch {
    // Storage unavailable (private mode): the selector falls back to the first property.
  }
}

export function lastProperty(): string | null {
  try {
    return localStorage.getItem(LAST_PROPERTY_KEY);
  } catch {
    return null;
  }
}
