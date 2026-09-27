'use client';

import { KitchenBoard } from '@/components/kitchen-board';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

export default function KitchenPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  return (
    <KitchenBoard
      propertyId={propertyId}
      pms={pms}
      can={(permission) => hasPermission(session.data, permission)}
    />
  );
}
