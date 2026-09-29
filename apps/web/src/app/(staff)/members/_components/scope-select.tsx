'use client';

import { NativeSelect } from '@hotel/ui';
import { t } from '@/lib/i18n';
import { ORG_SCOPE } from './scope';
import { usePropertyNames } from './use-property-names';

/** Scope choices the caller may target: organization only if they hold the grant there. */
export function ScopeSelect({
  value,
  onChange,
  allowOrganization,
}: {
  value: string;
  onChange: (v: string) => void;
  allowOrganization: boolean;
}) {
  const { items } = usePropertyNames();
  return (
    <NativeSelect
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t('members.scope')}
    >
      {allowOrganization && <option value={ORG_SCOPE}>{t('scope.organization')}</option>}
      {items.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </NativeSelect>
  );
}
