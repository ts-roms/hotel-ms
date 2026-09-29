'use client';

import { t } from '@/lib/i18n';
import { useProperties } from '@/lib/property';

export function usePropertyNames() {
  const properties = useProperties();
  const items = properties.data?.items ?? [];
  const nameOf = (id: string | null) =>
    id ? (items.find((p) => p.id === id)?.name ?? '—') : t('scope.organization');
  return { items, nameOf };
}
