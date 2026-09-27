'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api } from './api';

const LAST_PROPERTY_KEY = 'hotel.lastPropertyId';

export function useProperties() {
  return useQuery({ queryKey: ['properties'], queryFn: () => api.properties.list({ limit: 100 }) });
}

/** The property in the URL (/p/[propertyId]/...), if any. */
export function useRoutePropertyId(): string | undefined {
  const params = useParams<{ propertyId?: string }>();
  return params?.propertyId;
}

/** Property details, including its business date, currency and time zone. */
export function useProperty(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.properties.get(propertyId!).then((r) => r.data),
    enabled: !!propertyId,
  });
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
