'use client';

import type { Property } from '@hotel/contracts';
import { NativeSelect } from '@hotel/ui';
import { usePathname, useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';
import { propertySwitchTarget } from '@/lib/nav';
import { useSession } from '@/lib/session';

/** Property picker, shown when the member can see more than one property. */
export function PropertySwitcher({
  properties,
  propertyId,
}: {
  properties: Property[];
  propertyId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  if (properties.length < 2) return null;
  return (
    <NativeSelect
      aria-label={t('nav.property')}
      className="h-9"
      value={propertyId}
      // The property layout remembers the new property once it loads.
      onChange={(e) => router.push(propertySwitchTarget(pathname, e.target.value, session.data))}
    >
      {properties.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </NativeSelect>
  );
}
